"use client";

import { LiveCrewMap, type CrewShiftRow } from "@/components/console/live-crew-map";

const MAP_TABLES = ["shifts", "logs", "users", "sites"] as const;

/** Moderator live map. Rows come from LiveView (shared with the roster). */
export function ActiveShiftsMap({
  rows,
  selectedUserId,
  onSelectUser,
}: {
  rows: CrewShiftRow[] | undefined;
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
}) {
  return (
    <LiveCrewMap
      rows={rows}
      siteLayer="active"
      mapTables={MAP_TABLES}
      windowId="live-crew"
      title={(n) => `Live map${n !== undefined ? ` · ${n} on shift` : ""}`}
      ariaLabel="Map of employees currently on shift"
      refreshLabel="Refresh live crew map"
      emptyText="Nobody in this organisation is on shift right now."
      footerSegments={[
        { color: "#22d3ee", label: "site geofence" },
        { color: "#34d399", label: "inside geofence" },
        { color: "#f87171", label: "outside geofence" },
      ]}
      panHint="Map of employees currently on shift. Click a pin to open that employee."
      selectedUserId={selectedUserId}
      onSelectUser={onSelectUser}
    />
  );
}
