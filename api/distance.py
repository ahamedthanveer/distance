"""
Vercel serverless function: POST /api/distance

Body:
{
  "origin":      {"lat": 31.2304, "lon": 121.4737, "name": "Shanghai", "country": "China", "unlocode": "CNSHA"},
  "destination": {"lat": 51.9496, "lon":   4.1453, "name": "Rotterdam", "country": "Netherlands", "unlocode": "NLRTM"},
  "speedKnots":  14,
  "fuelTpd":     25,
  "bunkerUsd":   600
}

Uses the genthalili `searoute` package — a denser maritime network than searoute-ts,
with proper Suez/Panama transits and ~5km resolution. Falls back to great-circle
when the network can't connect a port pair.
"""
from http.server import BaseHTTPRequestHandler
import json
import traceback
from math import radians, sin, cos, asin, sqrt

import searoute as sr

EARTH_KM = 6371.0088
KM_TO_NM = 0.539957


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
    from math import atan2
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


def calculate(body):
    origin = body.get("origin")
    destination = body.get("destination")
    if not origin or not destination:
        return 400, {"error": "origin and destination objects are required"}
    if (origin.get("unlocode") and origin.get("unlocode") == destination.get("unlocode")):
        return 400, {"error": "Origin and destination are the same port"}
    for label, p in (("origin", origin), ("destination", destination)):
        if not isinstance(p.get("lat"), (int, float)) or not isinstance(p.get("lon"), (int, float)):
            return 400, {"error": f"{label}.lat and {label}.lon must be numbers"}

    speed = float(body.get("speedKnots") or 14)
    fuel_tpd = float(body.get("fuelTpd") or 25)
    bunker = float(body.get("bunkerUsd") or 600)

    gc_km = haversine_km(origin["lat"], origin["lon"], destination["lat"], destination["lon"])

    coords = []
    distance_km = 0.0
    mode = "sea"
    warnings = []

    try:
        route = sr.searoute(
            [origin["lon"], origin["lat"]],
            [destination["lon"], destination["lat"]],
            units="km",
            append_orig_dest=True,
        )
        # `route` is a geojson Feature — supports both attribute and dict access
        geom = getattr(route, "geometry", None) or route.get("geometry") if hasattr(route, "get") else route.geometry
        props = getattr(route, "properties", None) or (route.get("properties") if hasattr(route, "get") else {})
        raw_coords = getattr(geom, "coordinates", None) or (geom.get("coordinates") if hasattr(geom, "get") else [])
        if raw_coords:
            coords = [list(c) for c in raw_coords]
            distance_km = float(props.get("length", 0) or 0)
    except Exception as e:
        warnings.append(f"Sea routing error: {str(e)[:140]}")

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

    distance_nm = distance_km * KM_TO_NM
    hours = (distance_nm / speed) if speed > 0 else 0.0
    days = hours / 24.0
    fuel_mt = days * fuel_tpd
    fuel_cost = fuel_mt * bunker
    canals = detect_canals(coords)

    return 200, {
        "origin": origin,
        "destination": destination,
        "mode": mode,
        "engine": "searoute-py",
        "warnings": warnings,
        "geometry": {"type": "LineString", "coordinates": coords},
        "distance": {
            "km": round(distance_km, 1),
            "nm": round(distance_nm, 1),
            "mi": round(distance_km * 0.621371, 1),
            "greatCircleNm": round(gc_km * KM_TO_NM, 1),
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
        self._write(200, {"ok": True, "endpoint": "POST /api/distance", "engine": "searoute-py"})

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
