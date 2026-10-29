import { useEffect, useState, useRef } from "react";

export interface GeoState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  error: string | null;
  isTracking: boolean;
  permission: "prompt" | "granted" | "denied";
}

export function useGeolocation(enabled: boolean = true) {
  const [state, setState] = useState<GeoState>({
    lat: null,
    lng: null,
    accuracy: null,
    speed: null,
    heading: null,
    error: null,
    isTracking: false,
    permission: "prompt",
  });

  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState((s) => ({ ...s, error: "Geolocation is not supported by your browser." }));
      return;
    }

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" as PermissionName }).then((res) => {
        setState((s) => ({ ...s, permission: res.state as "prompt" | "granted" | "denied" }));
        res.onchange = () => {
          setState((s) => ({ ...s, permission: res.state as "prompt" | "granted" | "denied" }));
        };
      }).catch(() => {});
    }

    if (!enabled) {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      setState((s) => ({ ...s, isTracking: false }));
      return;
    }

    setState((s) => ({ ...s, isTracking: true, error: null }));

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          error: null,
          isTracking: true,
          permission: "granted",
        });
      },
      (err) => {
        setState((s) => ({
          ...s,
          error: err.message || "Failed to retrieve location.",
          permission: err.code === 1 ? "denied" : s.permission,
          isTracking: false,
        }));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 1500,
      }
    );

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [enabled]);

  return state;
}
