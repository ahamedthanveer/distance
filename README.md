# Sea Route Distance Calculator

A multi-stop voyage planner that calculates **sea route distance** between any sequence of commercial ports — similar to *Netpas Distance* or *Signal Ocean*.

- Routes avoid land, transit **Suez** and **Panama** when shorter, render the path on a map.
- Adds **multi-leg voyages** (A → B → C → D …) with per-leg and rolled-up totals (distance, time, fuel, bunker cost).
- **Per-pair caching**: every leg's distance is computed once and reused on subsequent voyages — including reverse direction (A→B and B→A share one cache entry, since sea distance is symmetric). This matters when the routing engine is a paid API.
- Honest **great-circle fallback** with warnings when the maritime network can't connect a port pair.

## Tech

- **Next.js 14** (App Router) — React frontend
- **Python serverless function** at `api/distance.py` using the
  [`searoute`](https://pypi.org/project/searoute/) package as the default routing engine
- **Upstash Redis** (REST) for the persistent leg cache (optional, see below)
- **Searoutes.com** integration scaffolded for chartering-grade accuracy
  (activated when an API key is configured — see below)
- **React-Leaflet / OpenStreetMap** map
- **TailwindCSS**
- Deploys to **Vercel**

## Routing engine selection

The backend automatically picks an engine based on env vars:

| Env var | Engine used | Accuracy |
| --- | --- | --- |
| *(none)* | `searoute-py` (default) | Good for ocean voyages, ±10–15% for short coastal hops |
| `SEAROUTES_API_KEY=…` | `searoutes-com` (REST) | Chartering-grade, ±1–2% vs published distance tables |

The cache key is namespaced per engine, so switching engines never returns cached lower-quality results.

## Cache (Upstash Redis)

Without cache configured, every leg recomputes on every call (fine for `searoute-py` which is local; expensive once you switch to `searoutes-com`).

To enable shared persistent caching:

1. In the Vercel dashboard for this project: **Storage → Marketplace → Upstash → For Redis** → create a free database.
2. Vercel auto-injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars into both Production and Preview.
3. Redeploy. The `/api/distance` `GET` endpoint will then report `"cacheEnabled": true`.

Cache entries:
- Key: `leg:v1:<engine>:<unlocode_a>-<unlocode_b>` (UN/LOCODEs sorted alphabetically)
- Value: distance + geometry + canal flags + timestamp
- TTL: indefinite (sea distances don't change)
- Invalidation: bump `CACHE_VERSION` in `api/distance.py` if you want to force a recompute

## Searoutes.com integration

Once you have an API key from <https://searoutes.com>:

1. Add `SEAROUTES_API_KEY=<your-key>` to Vercel env vars.
2. The wiring in `route_searoutes_com()` is currently a stub — drop in the REST call there. (Left intentionally for the moment when the key is in hand so the request shape can be validated.)
3. Redeploy.

The cache layer keeps every paid call to a maximum of one per port pair, in either direction.

## Getting started locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The Python function runs locally via `vercel dev` if you want to exercise it end-to-end:

```bash
vercel dev
```

## API

`POST /api/distance`

```json
{
  "origin":      {"lat": 31.2304, "lon": 121.4737, "name": "Shanghai", "country": "China", "unlocode": "CNSHA"},
  "destination": {"lat": 51.9496, "lon":   4.1453, "name": "Rotterdam", "country": "Netherlands", "unlocode": "NLRTM"},
  "speedKnots":  14,
  "fuelTpd":     25,
  "bunkerUsd":   600,
  "noCache":     false
}
```

Response includes `cached: true|false`, `engine`, distance (NM/km/mi), great-circle reference, voyage time, fuel, bunker cost, canal transit flags, and a route GeoJSON LineString.

## Disclaimer

Indicative figures only with the default engine. Does not account for weather routing, currents, draft restrictions, or pilotage. For chartering decisions, configure the Searoutes.com engine.
