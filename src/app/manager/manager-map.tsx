"use client";

import { useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { LiveCrewMap, type CrewShiftRow, type SiteToDraw } from "@/components/console/live-crew-map";

const MAP_TABLES = ["shifts", "logs", "users", "sites", "managerSites", "userSites", "travelSegments"] as const;

export function ManagerMap() {
  const rows = useQuery(api.manager.managedActiveShifts, {}) as CrewShiftRow[] | undefined;
  const managedSites = useQuery(api.manager.listManagedSites, {}) as SiteToDraw[] | undefined;
  return (
    <LiveCrewMap
      rows={rows}
      managedSites={managedSites}
      siteLayer="managed"
      mapTables={MAP_TABLES}
      title={(n) => `My crew on site${n !== undefined ? ` (${n})` : ""}`}
      ariaLabel="Map of crew assigned to your sites currently on shift"
      refreshLabel="Refresh manager map"
      emptyText="No crew on shift right now."
      footerSegments={[
        { color: "#22d3ee", label: "managed geofence" },
        { color: "#34d399", label: "inside geofence" },
        { color: "#fbbf24", label: "travelling (on-shift, off-site)" },
        { color: "#f87171", label: "off-site, no travel fixes" },
      ]}
      panHint="Map of crew assigned to your sites currently on shift. Use refresh to update."
    />
  );
}
