# Sea Route Distance Calculator

A web app that calculates the **sea route distance** between any two commercial ports — similar to *Netpas Distance* or *Signal Ocean*.

It uses the open-source **searoute** maritime network graph, so routes:

- avoid land masses,
- transit the **Suez** and **Panama** canals when that shortens the voyage,
- and produce a realistic GeoJSON line you can render on a map.

On top of pure distance, the calculator also estimates **voyage duration**, **bunker consumption** and **fuel cost** for the chosen service speed.

## Tech

- **Next.js 14** (App Router) – React + serverless API
- **searoute-ts** – Dijkstra over a global marine network
- **React-Leaflet / OpenStreetMap** – map rendering
- **TailwindCSS** – styling
- Deploys to **Vercel** out of the box

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## Deploy

This repo is wired for **Vercel**. Push to `main` and import the repo in Vercel — no environment variables required.

## API

`POST /api/route`

```json
{
  "origin":      "CNSHA",
  "destination": "NLRTM",
  "speedKnots":  14,
  "fuelTpd":     25,
  "bunkerUsd":   600
}
```

Returns distance (km / nm / mi), voyage hours/days, fuel and a route GeoJSON LineString.

## Disclaimer

Indicative figures only. Does not include weather routing, currents, draft restrictions, ECA zones or port pilotage. Use commercial services for chartering decisions.
