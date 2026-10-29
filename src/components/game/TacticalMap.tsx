import { useEffect, useRef } from "react";
import L from "leaflet";

interface RevealMarker {
  userId: string;
  kind: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  revealedAt: string;
}

interface TacticalMapProps {
  userLat: number | null;
  userLng: number | null;
  userRole: "hunter" | "shadow" | null;
  zoneCenter: { lat: number; lng: number } | null;
  zoneRadiusM: number | null;
  reveals: RevealMarker[];
  isOutsideZone?: boolean;
}

export function TacticalMap({
  userLat,
  userLng,
  userRole,
  zoneCenter,
  zoneRadiusM,
  reveals,
  isOutsideZone = false,
}: TacticalMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const selfMarkerRef = useRef<L.CircleMarker | null>(null);
  const zoneCircleRef = useRef<L.Circle | null>(null);
  const revealMarkersRef = useRef<L.LayerGroup | null>(null);

  // Initialize map with CARTO Dark Matter tiles (no API key required)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter = userLat && userLng ? [userLat, userLng] : [28.6139, 77.209];
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView(initialCenter as L.LatLngExpression, 16);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 19,
        subdomains: "abcd",
      }
    ).addTo(map);

    revealMarkersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update user self-marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (userLat && userLng) {
      const color = isOutsideZone ? "#ef4444" : userRole === "hunter" ? "#f97316" : "#22c55e";

      if (!selfMarkerRef.current) {
        selfMarkerRef.current = L.circleMarker([userLat, userLng], {
          radius: 9,
          fillColor: color,
          color: "#ffffff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
        }).addTo(map);
        map.panTo([userLat, userLng], { animate: true });
      } else {
        selfMarkerRef.current.setLatLng([userLat, userLng]);
        selfMarkerRef.current.setStyle({ fillColor: color });
      }
    }
  }, [userLat, userLng, userRole, isOutsideZone]);

  // Update safe-zone circle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (zoneCenter && zoneRadiusM) {
      if (!zoneCircleRef.current) {
        zoneCircleRef.current = L.circle([zoneCenter.lat, zoneCenter.lng], {
          radius: zoneRadiusM,
          color: "#a855f7",
          weight: 2,
          fillColor: "#a855f7",
          fillOpacity: 0.08,
          dashArray: "6, 6",
        }).addTo(map);
      } else {
        zoneCircleRef.current.setLatLng([zoneCenter.lat, zoneCenter.lng]);
        zoneCircleRef.current.setRadius(zoneRadiusM);
      }
    } else if (zoneCircleRef.current) {
      zoneCircleRef.current.remove();
      zoneCircleRef.current = null;
    }
  }, [zoneCenter, zoneRadiusM]);

  // Update ping and reveal markers
  useEffect(() => {
    const group = revealMarkersRef.current;
    if (!group) return;

    group.clearLayers();

    reveals.forEach((r) => {
      const isHunter = r.kind === "hunter_reveal";
      const markerColor = isHunter ? "#f97316" : "#22c55e";

      const pingMarker = L.circleMarker([r.lat, r.lng], {
        radius: 8,
        fillColor: markerColor,
        color: "#ffffff",
        weight: 1.5,
        fillOpacity: 0.85,
      });

      const timeAgo = Math.round((Date.now() - new Date(r.revealedAt).getTime()) / 1000);
      pingMarker.bindPopup(`
        <div style="background:#111;color:#fff;padding:4px;font-size:12px;font-family:sans-serif;">
          <strong>${isHunter ? "Hunter Revealed" : "Shadow Ping"}</strong><br/>
          Accuracy: ±${Math.round(r.accuracy || 0)}m<br/>
          ${timeAgo}s ago
        </div>
      `);

      group.addLayer(pingMarker);
    });
  }, [reveals]);

  return (
    <div className="relative w-full h-full min-h-[350px] rounded-xl overflow-hidden border border-zinc-800 shadow-2xl">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute bottom-3 left-3 z-[1000] bg-zinc-950/80 backdrop-blur border border-zinc-800 rounded-lg px-2.5 py-1 text-[11px] text-zinc-300 flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Shadow
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" /> Hunter
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full border border-dashed border-purple-500 inline-block" /> Safe Zone
        </span>
      </div>
    </div>
  );
}
