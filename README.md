# Sea Route Distance Calculator

A web app that calculates the **sea route distance** between any two commercial ports — similar to *Netpas Distance* or *Signal Ocean*.

It uses the open-source **searoute** maritime network graph, so routes:

- avoid land masses,
- transit the **Suez** and **Panama** canals when that shortens the voyage,
- and produce a realistic GeoJSON line you can render on a map.

On top of pure distance, the calculator also estimates **voyage duration**, **bunker consumption** and **fuel cost** for the chosen service speed.

## Tech

- **Next.js 14** (App Router) – React frontend, served from Vercel
- **Python serverless function** (`api/distance.py`) using the
  [`searoute`](https://pypi.org/project/searoute/) package – denser maritime
  network than the JS port, with proper Suez/Panama transits
- **React-Leaflet / OpenStreetMap** – map rendering
- **TailwindCSS** – styling
- Deploys to **Vercel** out of the box (Next.js + Python runtime)

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## Deploy

This repo is wired for **Vercel**. Push to `main` and import the repo in Vercel — no environment variables required.

## API

`POST /api/distance`

```json
{
  "origin":      {"lat": 31.2304, "lon": 121.4737, "name": "Shanghai", "country": "China", "unlocode": "CNSHA"},
  "destination": {"lat": 51.9496, "lon":   4.1453, "name": "Rotterdam", "country": "Netherlands", "unlocode": "NLRTM"},
  "speedKnots":  14,
  "fuelTpd":     25,
  "bunkerUsd":   600
}
```

Returns distance (km / nm / mi), voyage hours/days, fuel cost, canal transit
flags and a GeoJSON LineString of the routed path. Falls back to a
great-circle line with a `warnings` field when the maritime graph can't
connect the pair.

## Disclaimer

Indicative figures only. Does not include weather routing, currents, draft restrictions, ECA zones or port pilotage. Use commercial services for chartering decisions.
