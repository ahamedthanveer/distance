"""
Vercel serverless function: POST /api/distance

Body:
{
  "origin":      {"lat": 31.2304, "lon": 121.4737, "name": "Shanghai", "country": "China", "unlocode": "CNSHA"},
  "destination": {"lat": 51.9496, "lon":   4.1453, "name": "Rotterdam", "country": "Netherlands", "unlocode": "NLRTM"},
  "speedKnots":  14,
  "fuelTpd":     25,
  "bunkerUsd":   600,
  "noCache":     false
}

Routing engine:
  - For now: genthalili `searoute` (~5km marnet, Suez/Panama-aware)
  - Later: Searoutes.com REST API (chartering-grade), automatically used when
    SEAROUTES_API_KEY env var is set. Falls back to searoute-py otherwise.

Cache layer (Upstash Redis REST, optional):
  - Enabled when both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.
  - Key:   leg:v1:<engine>:<unlocode_a>-<unlocode_b>   (codes sorted lexicographically)
  - Value: JSON of {distance_km, geometry, canals, mode, warnings, ts, engine, ...}
  - Distance is symmetric, so requests in either direction hit the same key;
    geometry is reversed on read if needed.
  - When the engine changes (e.g. cutover to Searoutes.com), the cache prefix
    changes too — old, lower-quality entries are not silently reused.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import time
import traceback
import urllib.parse
import urllib.request
from math import radians, sin, cos, asin, sqrt, atan2

import searoute as sr

EARTH_KM = 6371.0088
KM_TO_NM = 0.539957

CACHE_VERSION = "v1"
SEAROUTES_API_KEY = os.environ.get("SEAROUTES_API_KEY", "").strip()
UPSTASH_URL = os.environ.get("UPSTASH_REDIS_REST_URL", "").strip().rstrip("/")
UPSTASH_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def haversine_km(lat1, lon1, lat2, lon2):
    la1, la2 = radians(lat1), radians(lat2)
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    h = sin(dlat / 2) ** 2 + cos(la1) * cos(la2) * sin(dlon / 2) ** 2
    return 2 * EARTH_KM * asin(sqrt(h))


def great_circle_coords(a, b, steps=64):
    lat1, lon1 = radians(a["lat"]), radians(a["lon"])
    lat2, lon2 = radians(b["lat"]), radians(b["lon"])
    d = 2 * asin(
        sqrt(
            sin((lat2 - lat1) / 2) ** 2
            + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
        )
    )
    if d == 0:
        return [[a["lon"], a["lat"]]]
    out = []
    for i in range(steps + 1):
        f = i / steps
        A = sin((1 - f) * d) / sin(d)
        B = sin(f * d) / sin(d)
        x = A * cos(lat1) * cos(lon1) + B * cos(lat2) * cos(lon2)
        y = A * cos(lat1) * sin(lon1) + B * cos(lat2) * sin(lon2)
        z = A * sin(lat1) + B * sin(lat2)
        lat = atan2(z, sqrt(x * x + y * y))
        lon = atan2(y, x)
        out.append([lon * 180 / 3.141592653589793, lat * 180 / 3.141592653589793])
    return out


def detect_canals(coords):
    suez = panama = False
    for c in coords:
        lon, lat = c[0], c[1]
        if not suez and 32.0 <= lon <= 32.8 and 29.7 <= lat <= 31.4:
            suez = True
        if not panama and -80.1 <= lon <= -79.3 and 8.7 <= lat <= 9.5:
            panama = True
        if suez and panama:
            break
    return {"suez": suez, "panama": panama}


# ---------------------------------------------------------------------------
# Routing engines
# ---------------------------------------------------------------------------

def route_searoute_py(origin, destination):
    """Compute a route using the local searoute-py marnet."""
    coords = []
    distance_km = 0.0
    warnings = []
    try:
        route = sr.searoute(
            [origin["lon"], origin["lat"]],
            [destination["lon"], destination["lat"]],
            units="km",
            append_orig_dest=True,
        )
        geom = getattr(route, "geometry", None) or (route.get("geometry") if hasattr(route, "get") else None)
        props = getattr(route, "properties", None) or (route.get("properties") if hasattr(route, "get") else {})
        raw_coords = getattr(geom, "coordinates", None) or (geom.get("coordinates") if hasattr(geom, "get") else [])
        if raw_coords:
            coords = [list(c) for c in raw_coords]
            distance_km = float(props.get("length", 0) or 0)
    except Exception as e:
        warnings.append(f"searoute-py error: {str(e)[:140]}")

    return {
        "engine": "searoute-py",
        "coords": coords,
        "distance_km": distance_km,
        "warnings": warnings,
    }


def route_searoutes_com(origin, destination):
    """Stub for the Searoutes.com REST integration. Wired when SEAROUTES_API_KEY is set."""
    # TODO: wire the real Searoutes.com endpoint once the API key is provided.
    # For now this stub is unreachable (we only call it when the key exists).
    raise NotImplementedError("Searoutes.com integration pending API key")


def pick_engine_name():
    return "searoutes-com" if SEAROUTES_API_KEY else "searoute-py"


def run_engine(origin, destination):
    if SEAROUTES_API_KEY:
        return route_searoutes_com(origin, destination)
    return route_searoute_py(origin, destination)


# ---------------------------------------------------------------------------
# Cache (Upstash Redis REST, optional)
# ---------------------------------------------------------------------------

def cache_enabled():
    return bool(UPSTASH_URL and UPSTASH_TOKEN)


def cache_key(engine, a_code, b_code):
    a, b = sorted([a_code.upper(), b_code.upper()])
    return f"leg:{CACHE_VERSION}:{engine}:{a}-{b}"


def _upstash_request(path):
    req = urllib.request.Request(
        f"{UPSTASH_URL}{path}",
        headers={"Authorization": f"Bearer {UPSTASH_TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def cache_get(key):
    if not cache_enabled():
        return None
    body = _upstash_request(f"/get/{urllib.parse.quote(key, safe='')}")
    if not body or body.get("result") in (None, ""):
        return None
    try:
        return json.loads(body["result"])
    except Exception:
        return None


def cache_set(key, value):
    if not cache_enabled():
        return
    encoded = urllib.parse.quote(json.dumps(value, separators=(",", ":")), safe="")
    _upstash_request(f"/set/{urllib.parse.quote(key, safe='')}/{encoded}")


# ---------------------------------------------------------------------------
# Main calculation
# ---------------------------------------------------------------------------

def validate_port(label, p):
    if not isinstance(p, dict):
        return f"{label} must be an object with lat/lon/unlocode"
    if not isinstance(p.get("lat"), (int, float)) or not isinstance(p.get("lon"), (int, float)):
        return f"{label}.lat and {label}.lon must be numbers"
    if not p.get("unlocode"):
        return f"{label}.unlocode is required (used as cache key)"
    return None


def assemble_response(origin, destination, leg_data, speed, fuel_tpd, bunker, cached):
    distance_km = leg_data["distance_km"]
    coords = leg_data["coords"]
    warnings = list(leg_data.get("warnings", []))
    mode = leg_data.get("mode", "sea")
    canals = leg_data.get("canals") or detect_canals(coords)

    distance_nm = distance_km * KM_TO_NM
    hours = (distance_nm / speed) if speed > 0 else 0.0
    days = hours / 24.0
    fuel_mt = days * fuel_tpd
    fuel_cost = fuel_mt * bunker

    return {
        "origin": origin,
        "destination": destination,
        "mode": mode,
        "engine": leg_data.get("engine", pick_engine_name()),
        "cached": cached,
        "warnings": warnings,
        "geometry": {"type": "LineString", "coordinates": coords},
        "distance": {
            "km": round(distance_km, 1),
            "nm": round(distance_nm, 1),
            "mi": round(distance_km * 0.621371, 1),
            "greatCircleNm": round(haversine_km(origin["lat"], origin["lon"], destination["lat"], destination["lon"]) * KM_TO_NM, 1),
        },
        "voyage": {
            "speedKnots": speed,
            "hours": round(hours, 1),
            "days": round(days, 2),
        },
        "fuel": {
            "tonsPerDay": fuel_tpd,
            "totalMt": round(fuel_mt, 1),
            "bunkerUsdPerMt": bunker,
            "totalUsd": round(fuel_cost, 0),
        },
        "canals": canals,
    }


def calculate(body):
    origin = body.get("origin")
    destination = body.get("destination")

    err = validate_port("origin", origin) or validate_port("destination", destination)
    if err:
        return 400, {"error": err}
    if origin["unlocode"] == destination["unlocode"]:
        return 400, {"error": "Origin and destination are the same port"}

    speed = float(body.get("speedKnots") or 14)
    fuel_tpd = float(body.get("fuelTpd") or 25)
    bunker = float(body.get("bunkerUsd") or 600)
    no_cache = bool(body.get("noCache"))

    engine = pick_engine_name()
    key = cache_key(engine, origin["unlocode"], destination["unlocode"])

    # 1. Try cache
    if not no_cache:
        cached = cache_get(key)
        if cached and cached.get("coords"):
            # Reverse geometry if request direction differs from canonical (sorted) direction
            sorted_codes = sorted([origin["unlocode"].upper(), destination["unlocode"].upper()])
            cached_data = dict(cached)
            if origin["unlocode"].upper() != sorted_codes[0]:
                cached_data["coords"] = list(reversed(cached_data["coords"]))
            return 200, assemble_response(
                origin, destination, cached_data, speed, fuel_tpd, bunker, cached=True
            )

    # 2. Run engine
    result = run_engine(origin, destination)
    coords = result["coords"]
    distance_km = result["distance_km"]
    warnings = list(result.get("warnings", []))
    mode = "sea"

    gc_km = haversine_km(origin["lat"], origin["lon"], destination["lat"], destination["lon"])
    if not coords or distance_km == 0:
        coords = great_circle_coords(origin, destination, 64)
        distance_km = gc_km
        mode = "great-circle"
        warnings.append(
            "No path found on the maritime network — showing great-circle distance instead. Real sea distance will be longer."
        )
    else:
        detour = distance_km / max(gc_km, 1.0)
        if detour > 2.0:
            warnings.append(
                f"The computed route is {detour:.1f}× the great-circle distance — the maritime network may not connect this corridor cleanly. Treat as an upper bound."
            )

    canals = detect_canals(coords)

    leg_data = {
        "engine": result["engine"],
        "coords": coords,
        "distance_km": distance_km,
        "warnings": warnings,
        "mode": mode,
        "canals": canals,
        "ts": int(time.time()),
    }

    # 3. Store in cache (only if mode == 'sea' — never cache great-circle fallbacks
    #    so that future fixes to the engine get a chance to produce a real route)
    if mode == "sea" and not no_cache:
        # Cache must be stored against the canonical (sorted) direction
        sorted_codes = sorted([origin["unlocode"].upper(), destination["unlocode"].upper()])
        canonical_coords = leg_data["coords"]
        if origin["unlocode"].upper() != sorted_codes[0]:
            canonical_coords = list(reversed(canonical_coords))
        cache_set(key, {**leg_data, "coords": canonical_coords})

    return 200, assemble_response(
        origin, destination, leg_data, speed, fuel_tpd, bunker, cached=False
    )


class handler(BaseHTTPRequestHandler):
    def _write(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._write(204, {})

    def do_GET(self):
        self._write(200, {
            "ok": True,
            "endpoint": "POST /api/distance",
            "engine": pick_engine_name(),
            "cacheEnabled": cache_enabled(),
        })

    def do_POST(self):
        try:
            length = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(length) if length > 0 else b"{}"
            body = json.loads(raw or b"{}")
        except Exception as e:
            return self._write(400, {"error": f"Invalid JSON body: {e}"})

        try:
            status, payload = calculate(body)
        except Exception as e:
            return self._write(500, {
                "error": "Internal error during routing",
                "detail": str(e),
                "trace": traceback.format_exc().splitlines()[-6:],
            })
        self._write(status, payload)
