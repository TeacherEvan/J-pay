"use client";

import { useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { LiveCrewMap, type CrewShiftRow } from "@/components/console/live-crew-map";

const MAP_TABLES = ["shifts", "logs", "users", "sites"] as const;

export function ActiveShiftsMap() {
  const rows = useQuery(api.moderator.activeShifts, {}) as CrewShiftRow[] | undefined;
  return (
    <LiveCrewMap
      rows={rows}
      siteLayer="active"
      mapTables={MAP_TABLES}
      windowId="live-crew"
      title={(n) => `Live crew${n !== undefined ? ` (${n})` : ""}`}
      ariaLabel="Map of employees currently on shift"
      refreshLabel="Refresh live crew map"
      emptyText="No active shifts right now."
      footerSegments={[
        { color: "#22d3ee", label: "site geofence" },
        { color: "#34d399", label: "inside geofence" },
        { color: "#f87171", label: "outside geofence" },
      ]}
      panHint="Map of employees currently on shift. Use refresh to update."
    />
  );
}
