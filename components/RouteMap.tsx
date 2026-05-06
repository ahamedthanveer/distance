"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

const icon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface Stop {
  lat: number;
  lon: number;
  name: string;
  unlocode?: string;
}

interface Leg {
  cached?: boolean;
  geometry?: { coordinates: [number, number][] } | null;
}

interface Props {
  stops: Stop[];
  legs: Leg[];
}

function FitBounds({ allLatLng }: { allLatLng: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (allLatLng.length === 0) return;
    const b = L.latLngBounds(allLatLng);
    map.fitBounds(b, { padding: [40, 40], maxZoom: 6 });
  }, [allLatLng, map]);
  return null;
}

function splitAntimeridian(positions: [number, number][]): [number, number][][] {
  if (positions.length === 0) return [];
  const segments: [number, number][][] = [];
  let current: [number, number][] = [positions[0]];
  for (let i = 1; i < positions.length; i++) {
    const [, prevLon] = positions[i - 1];
    const [, lon] = positions[i];
    if (Math.abs(lon - prevLon) > 180) {
      segments.push(current);
      current = [];
    }
    current.push(positions[i]);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export default function RouteMap({ stops, legs }: Props) {
  // Build a set of [lat,lon] points for fitBounds
  const allLatLng: [number, number][] = [];
  stops.forEach((s) => allLatLng.push([s.lat, s.lon]));
  legs.forEach((l) => {
    (l.geometry?.coordinates ?? []).forEach(([lon, lat]) => allLatLng.push([lat, lon]));
  });

  return (
    <MapContainer center={[20, 20]} zoom={2} worldCopyJump className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {legs.map((leg, idx) => {
        const positions: [number, number][] = (leg.geometry?.coordinates ?? []).map(
          ([lon, lat]) => [lat, lon] as [number, number]
        );
        const segments = splitAntimeridian(positions);
        const color = leg.cached ? "#15803d" : "#0284c7";
        return segments.map((seg, j) => (
          <Polyline
            key={`${idx}-${j}`}
            positions={seg}
            pathOptions={{ color, weight: 3, opacity: 0.85 }}
          />
        ));
      })}
      {stops.map((s, i) => (
        <Marker key={i} position={[s.lat, s.lon]} icon={icon}>
          <Popup>
            <div className="font-semibold">Stop {i + 1}: {s.name}</div>
            {s.unlocode && <div className="text-xs text-slate-500">{s.unlocode}</div>}
          </Popup>
        </Marker>
      ))}
      <FitBounds allLatLng={allLatLng} />
    </MapContainer>
  );
}
