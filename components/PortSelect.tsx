"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PORTS, Port, searchPorts } from "@/lib/ports";

interface Props {
  label: string;
  value: string | null;
  onChange: (unlocode: string) => void;
  placeholder?: string;
}

export default function PortSelect({ label, value, onChange, placeholder }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => PORTS.find((p) => p.unlocode === value) ?? null, [value]);
  const results = useMemo(() => searchPorts(query, 14), [query]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function pick(p: Port) {
    onChange(p.unlocode);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="w-full" ref={ref}>
      <label className="block text-xs font-semibold uppercase tracking-wider text-ocean-700 mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
          placeholder={placeholder ?? "Search by port name, country or UN/LOCODE…"}
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
                  pick(p);
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
    </div>
  );
}
