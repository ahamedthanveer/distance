"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import StopList from "@/components/StopList";
import { findPort, Port } from "@/lib/ports";

const RouteMap = dynamic(() => import("@/components/RouteMap"), { ssr: false });

interface LegResult {
  origin: Port;
  destination: Port;
  mode: "sea" | "great-circle";
  engine: string;
  cached: boolean;
  warnings: string[];
  geometry: { type: string; coordinates: [number, number][] };
  distance: { km: number; nm: number; mi: number; greatCircleNm: number };
  voyage: { speedKnots: number; hours: number; days: number };
  fuel: { tonsPerDay: number; totalMt: number; bunkerUsdPerMt: number; totalUsd: number };
  canals: { suez: boolean; panama: boolean };
}

export default function Home() {
  const [stops, setStops] = useState<(string | null)[]>(["CNSHA", "SGSIN", "NLRTM"]);
  const [speed, setSpeed] = useState(14);
  const [fuel, setFuel] = useState(25);
  const [bunker, setBunker] = useState(600);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<LegResult[]>([]);

  const ports = stops.map((c) => (c ? findPort(c) : null));
  const allValid = ports.every((p) => !!p);

  async function calculate() {
    setError(null);
    setLegs([]);
    if (!allValid || ports.length < 2) {
      setError("Pick at least two valid ports.");
      return;
    }
    setLoading(true);
    try {
      const out: LegResult[] = [];
      for (let i = 0; i < ports.length - 1; i++) {
        const a = ports[i]!;
        const b = ports[i + 1]!;
        if (a.unlocode === b.unlocode) {
          throw new Error(`Stop ${i + 1} and stop ${i + 2} are the same port.`);
        }
        const res = await fetch("/api/distance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: a,
            destination: b,
            speedKnots: speed,
            fuelTpd: fuel,
            bunkerUsd: bunker,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Leg ${i + 1} failed`);
        out.push(json as LegResult);
        setLegs([...out]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const stopObjs = ports.filter((p): p is Port => !!p);

  const totals = legs.reduce(
    (acc, l) => {
      acc.km += l.distance.km;
      acc.nm += l.distance.nm;
      acc.hours += l.voyage.hours;
      acc.days += l.voyage.days;
      acc.fuelMt += l.fuel.totalMt;
      acc.fuelUsd += l.fuel.totalUsd;
      acc.cachedHits += l.cached ? 1 : 0;
      acc.suez = acc.suez || l.canals.suez;
      acc.panama = acc.panama || l.canals.panama;
      return acc;
    },
    { km: 0, nm: 0, hours: 0, days: 0, fuelMt: 0, fuelUsd: 0, cachedHits: 0, suez: false, panama: false }
  );

  return (
    <main className="min-h-screen">
      <header className="bg-ocean-700 text-white">
        <div className="mx-auto max-w-7xl px-4 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sea Route Distance Calculator</h1>
            <p className="text-ocean-100 text-sm">
              Multi-stop voyages with cached leg distances. Suez & Panama aware.
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

      <div className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
        <section className="space-y-4">
          <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ocean-700">Voyage stops</h2>
            <StopList stops={stops} onChange={setStops} />
          </div>

          <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Voyage parameters</h2>
            <NumField label="Service speed (knots)" value={speed} onChange={setSpeed} step={0.5} min={1} max={30} />
            <NumField label="Fuel consumption (mt/day)" value={fuel} onChange={setFuel} step={1} min={1} max={300} />
            <NumField label="Bunker price (USD/mt)" value={bunker} onChange={setBunker} step={10} min={100} max={2000} />
          </div>

          <button
            onClick={calculate}
            disabled={loading || !allValid}
            className="w-full rounded-lg bg-ocean-600 py-3 text-white font-semibold shadow-sm hover:bg-ocean-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {loading ? "Calculating legs…" : `Calculate voyage (${Math.max(stops.length - 1, 0)} legs)`}
          </button>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {legs.length > 0 && (
            <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">Voyage totals</h2>
                <span className="text-xs text-slate-500">
                  {totals.cachedHits}/{legs.length} legs from cache
                </span>
              </div>
              <Stat label="Total distance" value={`${totals.nm.toLocaleString(undefined, { maximumFractionDigits: 1 })} NM`} sub={`${Math.round(totals.km).toLocaleString()} km`} />
              <Stat label="Total time" value={`${totals.days.toFixed(2)} days`} sub={`${totals.hours.toFixed(1)} h at ${speed} kn`} />
              <Stat label="Total fuel" value={`${totals.fuelMt.toFixed(1)} mt`} sub={`${fuel} mt/day`} />
              <Stat label="Total bunker cost" value={`$${Math.round(totals.fuelUsd).toLocaleString()}`} sub={`@ $${bunker}/mt`} />
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 text-xs">
                {totals.suez && <Pill color="amber">Suez transit on voyage</Pill>}
                {totals.panama && <Pill color="emerald">Panama transit on voyage</Pill>}
                {!totals.suez && !totals.panama && <Pill color="slate">No canal transits</Pill>}
              </div>
            </div>
          )}

          {legs.length > 0 && (
            <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-700">Legs</h2>
              <ol className="space-y-2">
                {legs.map((l, i) => (
                  <li key={i} className="border border-slate-100 rounded-lg p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-900">
                          Leg {i + 1}: {l.origin.name} → {l.destination.name}
                        </div>
                        <div className="text-xs text-slate-500 font-mono">
                          {l.origin.unlocode} → {l.destination.unlocode}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {l.cached ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold uppercase tracking-wider">
                            cached
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-ocean-100 text-ocean-800 text-[10px] font-semibold uppercase tracking-wider">
                            live
                          </span>
                        )}
                        {l.mode === "great-circle" && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase tracking-wider">
                            GC
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
                      <div>
                        <div className="font-semibold text-slate-900">{l.distance.nm.toLocaleString()} NM</div>
                        <div className="text-[10px] text-slate-400">distance</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{l.voyage.days.toFixed(2)} d</div>
                        <div className="text-[10px] text-slate-400">@ {l.voyage.speedKnots} kn</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{l.fuel.totalMt.toFixed(1)} mt</div>
                        <div className="text-[10px] text-slate-400">fuel</div>
                      </div>
                    </div>
                    {(l.canals.suez || l.canals.panama) && (
                      <div className="mt-2 flex gap-1.5 text-[10px]">
                        {l.canals.suez && <Pill color="amber">Suez</Pill>}
                        {l.canals.panama && <Pill color="emerald">Panama</Pill>}
                      </div>
                    )}
                    {l.warnings.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {l.warnings.map((w, j) => (
                          <li key={j} className="text-[11px] text-amber-700">⚠ {w}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Each leg is computed once per port pair and reused on subsequent voyages — including reverse direction.
            Distances are indicative; for chartering decisions, configure the Searoutes.com engine via env vars
            (see README).
          </p>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden h-[70vh] lg:h-[85vh] sticky top-4">
          <RouteMap stops={stopObjs} legs={legs} />
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

function Pill({ color, children }: { color: "amber" | "emerald" | "slate"; children: React.ReactNode }) {
  const cls = {
    amber: "bg-amber-100 text-amber-800",
    emerald: "bg-emerald-100 text-emerald-800",
    slate: "bg-slate-100 text-slate-700",
  }[color];
  return <span className={`px-2 py-1 rounded-full font-medium ${cls}`}>{children}</span>;
}
