"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import PortSelect from "@/components/PortSelect";
import { findPort } from "@/lib/ports";

const RouteMap = dynamic(() => import("@/components/RouteMap"), { ssr: false });

interface RouteResult {
  origin: { name: string; country: string; unlocode: string; lat: number; lon: number };
  destination: { name: string; country: string; unlocode: string; lat: number; lon: number };
  mode: "sea" | "great-circle";
  warnings: string[];
  geometry: { type: string; coordinates: [number, number][] };
  distance: { km: number; nm: number; mi: number; greatCircleNm: number };
  voyage: { speedKnots: number; hours: number; days: number };
  fuel: { tonsPerDay: number; totalMt: number; bunkerUsdPerMt: number; totalUsd: number };
  canals: { suez: boolean; panama: boolean };
}

export default function Home() {
  const [origin, setOrigin] = useState<string | null>("CNSHA");
  const [destination, setDestination] = useState<string | null>("NLRTM");
  const [speed, setSpeed] = useState(14);
  const [fuel, setFuel] = useState(25);
  const [bunker, setBunker] = useState(600);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteResult | null>(null);

  const o = origin ? findPort(origin) : null;
  const d = destination ? findPort(destination) : null;

  async function calculate() {
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          destination,
          speedKnots: speed,
          fuelTpd: fuel,
          bunkerUsd: bunker,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to calculate route");
      setResult(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function swap() {
    setOrigin(destination);
    setDestination(origin);
    setResult(null);
  }

  return (
    <main className="min-h-screen">
      <header className="bg-ocean-700 text-white">
        <div className="mx-auto max-w-7xl px-4 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sea Route Distance Calculator</h1>
            <p className="text-ocean-100 text-sm">
              Maritime routing across the global shipping network — Suez & Panama aware.
            </p>
          </div>
          <a
            href="https://github.com/ahamedthanveer/distance"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-ocean-100 hover:text-white underline"
          >
            View source
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        <section className="space-y-4">
          <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-4 space-y-3">
            <PortSelect label="Origin port" value={origin} onChange={setOrigin} />
            <div className="flex justify-end">
              <button
                onClick={swap}
                className="text-xs text-ocean-700 hover:text-ocean-900 font-medium"
                title="Swap origin and destination"
              >
                ↕ Swap
              </button>
            </div>
            <PortSelect label="Destination port" value={destination} onChange={setDestination} />
          </div>

          <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Voyage parameters</h2>
            <NumField label="Service speed (knots)" value={speed} onChange={setSpeed} step={0.5} min={1} max={30} />
            <NumField label="Fuel consumption (mt/day)" value={fuel} onChange={setFuel} step={1} min={1} max={300} />
            <NumField label="Bunker price (USD/mt)" value={bunker} onChange={setBunker} step={10} min={100} max={2000} />
          </div>

          <button
            onClick={calculate}
            disabled={loading || !origin || !destination || origin === destination}
            className="w-full rounded-lg bg-ocean-600 py-3 text-white font-semibold shadow-sm hover:bg-ocean-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {loading ? "Calculating route…" : "Calculate sea distance"}
          </button>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-700">Route results</h2>
              <Stat
                label={result.mode === "sea" ? "Sea distance" : "Distance (great-circle fallback)"}
                value={`${result.distance.nm.toLocaleString()} NM`}
                sub={`${result.distance.km.toLocaleString()} km · ${result.distance.mi.toLocaleString()} mi · GC ref ${result.distance.greatCircleNm.toLocaleString()} NM`}
              />
              <Stat label="Estimated voyage" value={`${result.voyage.days} days`} sub={`${result.voyage.hours.toLocaleString()} h at ${result.voyage.speedKnots} kn`} />
              <Stat label="Fuel consumed" value={`${result.fuel.totalMt.toLocaleString()} mt`} sub={`${result.fuel.tonsPerDay} mt/day`} />
              <Stat label="Bunker cost" value={`$${result.fuel.totalUsd.toLocaleString()}`} sub={`@ $${result.fuel.bunkerUsdPerMt}/mt`} />
              <div className="pt-2 border-t border-slate-100 flex gap-2 flex-wrap text-xs">
                {result.canals.suez && (
                  <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-medium">Suez Canal transit</span>
                )}
                {result.canals.panama && (
                  <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 font-medium">Panama Canal transit</span>
                )}
                {!result.canals.suez && !result.canals.panama && (
                  <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">Open-ocean route</span>
                )}
              </div>
              {result.warnings.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-amber-700">⚠ {w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Distances are computed on a global maritime network graph (similar to Netpas / Signal Ocean). Routes
            avoid land masses and prefer canal transits where they shorten the voyage. Figures are indicative
            and exclude weather routing, current, draft restrictions and port-specific pilotage.
          </p>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden h-[70vh] lg:h-[80vh]">
          <RouteMap
            origin={o ? { lat: o.lat, lon: o.lon, name: o.name } : null}
            destination={d ? { lat: d.lat, lon: d.lon, name: d.name } : null}
            geometry={result?.geometry ?? null}
          />
        </section>
      </div>
    </main>
  );
}

function NumField({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step: number;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-ocean-700 mb-1">
        {label}
      </label>
      <input
        type="number"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
