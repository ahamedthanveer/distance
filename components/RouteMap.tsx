"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

// Fix default marker icons in Leaflet under bundlers
const icon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface Props {
  origin: { lat: number; lon: number; name: string } | null;
  destination: { lat: number; lon: number; name: string } | null;
  geometry?: { type: string; coordinates: [number, number][] } | null;
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    const b = L.latLngBounds(positions.map(([la, lo]) => [la, lo] as [number, number]));
    map.fitBounds(b, { padding: [40, 40], maxZoom: 6 });
  }, [positions, map]);
  return null;
}

export default function RouteMap({ origin, destination, geometry }: Props) {
  const positions: [number, number][] = (geometry?.coordinates ?? []).map(
    ([lon, lat]) => [lat, lon] as [number, number]
  );

  // Split route into segments at antimeridian crossings so the line doesn't wrap weirdly
  const segments: [number, number][][] = [];
  if (positions.length > 0) {
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
  }

  return (
    <MapContainer
      center={[20, 20]}
      zoom={2}
      worldCopyJump
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {segments.map((seg, i) => (
        <Polyline key={i} positions={seg} pathOptions={{ color: "#0284c7", weight: 3, opacity: 0.85 }} />
      ))}
      {origin && (
        <Marker position={[origin.lat, origin.lon]} icon={icon}>
          <Popup>Origin: {origin.name}</Popup>
        </Marker>
      )}
      {destination && (
        <Marker position={[destination.lat, destination.lon]} icon={icon}>
          <Popup>Destination: {destination.name}</Popup>
        </Marker>
      )}
      <FitBounds positions={positions} />
    </MapContainer>
  );
}
