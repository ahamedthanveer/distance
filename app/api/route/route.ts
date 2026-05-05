import { NextRequest, NextResponse } from "next/server";
import { seaRoute } from "searoute-ts";
// @ts-expect-error — @turf/helpers ships types but they aren't reachable via package.json exports
import { point } from "@turf/helpers";
import { findPort, Port } from "@/lib/ports";

export const runtime = "nodejs";

const KM_TO_NM = 0.539957;
const EARTH_KM = 6371.0088;

interface Body {
  origin?: string;
  destination?: string;
  speedKnots?: number;
  fuelTpd?: number;
  bunkerUsd?: number;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { origin, destination, speedKnots = 14, fuelTpd = 25, bunkerUsd = 600 } = body;
  if (!origin || !destination) {
    return NextResponse.json(
      { error: "origin and destination UN/LOCODEs are required" },
      { status: 400 }
    );
  }
  if (origin === destination) {
    return NextResponse.json({ error: "Origin and destination are the same port" }, { status: 400 });
  }
  const a = findPort(origin);
  const b = findPort(destination);
  if (!a || !b) {
    return NextResponse.json({ error: "Unknown port code" }, { status: 404 });
  }

  const greatCircleKm = haversineKm(a, b);

  let coords: [number, number][] = [];
  let distanceKm = 0;
  let mode: "sea" | "great-circle" = "sea";
  const warnings: string[] = [];

  try {
    const route = seaRoute(point([a.lon, a.lat]), point([b.lon, b.lat]), "kilometers");
    if (route && route.geometry?.coordinates?.length) {
      coords = route.geometry.coordinates as [number, number][];
      distanceKm = (route.properties?.length as number) ?? 0;
    }
  } catch {
    // fall through to great-circle fallback
  }

  if (coords.length === 0 || distanceKm === 0) {
    coords = greatCircleCoords(a, b, 64);
    distanceKm = greatCircleKm;
    mode = "great-circle";
    warnings.push(
      "No path found on the maritime network — showing great-circle (rhumb) distance instead. Actual sea distance will be longer."
    );
  } else {
    const detour = distanceKm / Math.max(greatCircleKm, 1);
    // Real sea routes — even via Suez or Panama — rarely exceed ~1.8x the great-circle
    // distance. Larger ratios usually indicate the underlying maritime network graph has
    // gaps for this corridor (most often the open North Pacific) and is forcing a
    // detour. Surface that to the user instead of silently returning a wrong number.
    if (detour > 2.0) {
      warnings.push(
        `The computed route is ${detour.toFixed(1)}× the great-circle distance — the underlying maritime network may not connect this corridor directly. Treat the figure as an upper bound.`
      );
    }
  }

  const distanceNm = distanceKm * KM_TO_NM;
  const hours = speedKnots > 0 ? distanceNm / speedKnots : 0;
  const days = hours / 24;
  const fuelMt = days * fuelTpd;
  const fuelCost = fuelMt * bunkerUsd;
  const flags = detectCanals(coords);

  return NextResponse.json({
    origin: a,
    destination: b,
    mode,
    warnings,
    geometry: { type: "LineString", coordinates: coords },
    distance: {
      km: round(distanceKm, 1),
      nm: round(distanceNm, 1),
      mi: round(distanceKm * 0.621371, 1),
      greatCircleNm: round(greatCircleKm * KM_TO_NM, 1),
    },
    voyage: {
      speedKnots,
      hours: round(hours, 1),
      days: round(days, 2),
    },
    fuel: {
      tonsPerDay: fuelTpd,
      totalMt: round(fuelMt, 1),
      bunkerUsdPerMt: bunkerUsd,
      totalUsd: round(fuelCost, 0),
    },
    canals: flags,
  });
}

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

function greatCircleCoords(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  steps: number
): [number, number][] {
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
      )
    );
  const out: [number, number][] = [];
  if (d === 0) return [[a.lon, a.lat]];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    out.push([(lon * 180) / Math.PI, (lat * 180) / Math.PI]);
  }
  return out;
}

function detectCanals(coords: [number, number][]): { suez: boolean; panama: boolean } {
  // Suez Canal corridor: from Port Said (32.30, 31.27) to Suez (32.55, 29.97).
  // Generous bbox to catch waypoints near either endpoint.
  // Panama Canal corridor: from Cristobal (-79.92, 9.35) to Balboa (-79.55, 8.95).
  let suez = false;
  let panama = false;
  for (const [lon, lat] of coords) {
    if (!suez && lon >= 32.0 && lon <= 32.8 && lat >= 29.7 && lat <= 31.4) suez = true;
    if (!panama && lon >= -80.1 && lon <= -79.3 && lat >= 8.7 && lat <= 9.5) panama = true;
    if (suez && panama) break;
  }
  return { suez, panama };
}

// Re-export Port for type-narrowing in route handlers if needed in the future.
export type { Port };
