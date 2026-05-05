import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "Sea Route Distance Calculator",
  description:
    "Calculate maritime distance, ETA, fuel and route between any two ports — accounting for land, Suez and Panama canals.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
