"use client";

import { Port, PORTS } from "@/lib/ports";
import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  stops: (string | null)[]; // UN/LOCODEs, in order
  onChange: (next: (string | null)[]) => void;
}

export default function StopList({ stops, onChange }: Props) {
  function setStop(i: number, code: string) {
    const next = [...stops];
    next[i] = code;
    onChange(next);
  }
  function addStop() {
    onChange([...stops, null]);
  }
  function removeStop(i: number) {
    if (stops.length <= 2) return;
    onChange(stops.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {stops.map((code, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex flex-col items-center pt-2 text-xs text-slate-400 font-mono w-5">
            <span className="font-semibold text-ocean-700">{i + 1}</span>
          </div>
          <div className="flex-1">
            <PortPicker
              value={code}
              placeholder={i === 0 ? "Origin port" : i === stops.length - 1 ? "Final port" : `Waypoint ${i}`}
              onChange={(c) => setStop(i, c)}
            />
          </div>
          <div className="flex flex-col gap-1 pt-1.5">
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="text-xs text-slate-500 hover:text-ocean-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move up"
            >
              ▲
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === stops.length - 1}
              className="text-xs text-slate-500 hover:text-ocean-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move down"
            >
              ▼
            </button>
          </div>
          <button
            onClick={() => removeStop(i)}
            disabled={stops.length <= 2}
            className="text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed pt-2"
            title="Remove stop"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={addStop}
        className="text-sm font-medium text-ocean-700 hover:text-ocean-900"
      >
        + Add stop
      </button>
    </div>
  );
}

function PortPicker({
  value,
  placeholder,
  onChange,
}: {
  value: string | null;
  placeholder: string;
  onChange: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => PORTS.find((p) => p.unlocode === value) ?? null, [value]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PORTS.slice(0, 14);
    const starts: Port[] = [];
    const contains: Port[] = [];
    for (const p of PORTS) {
      const hay = `${p.name} ${p.country} ${p.unlocode}`.toLowerCase();
      if (p.name.toLowerCase().startsWith(q) || p.unlocode.toLowerCase().startsWith(q)) starts.push(p);
      else if (hay.includes(q)) contains.push(p);
      if (starts.length >= 14) break;
    }
    return [...starts, ...contains].slice(0, 14);
  }, [query]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
        placeholder={placeholder}
        value={open ? query : selected ? `${selected.name} · ${selected.country} (${selected.unlocode})` : query}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">No matching ports</li>
          )}
          {results.map((p) => (
            <li
              key={p.unlocode}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(p.unlocode);
                setQuery("");
                setOpen(false);
              }}
              className="cursor-pointer px-3 py-2 text-sm hover:bg-ocean-50"
            >
              <div className="font-medium text-slate-900">{p.name}</div>
              <div className="text-xs text-slate-500">
                {p.country} · <span className="font-mono">{p.unlocode}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
