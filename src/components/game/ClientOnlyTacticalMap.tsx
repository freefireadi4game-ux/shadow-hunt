import { useEffect, useState } from "react";

export function ClientOnlyTacticalMap(
  props: Record<string, unknown>
) {
  const [MapComponent, setMapComponent] =
    useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    let active = true;

    import("./TacticalMap").then(({ TacticalMap }) => {
      if (active) {
        setMapComponent(() => TacticalMap);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  if (!MapComponent) {
    return <div className="min-h-[320px]">Loading map...</div>;
  }

  return <MapComponent {...props} />;
}
