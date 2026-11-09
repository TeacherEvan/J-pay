import type { Id } from "../../../convex/_generated/dataModel";

export const STATUSES = [
  "arrived",
  "checkpoint",
  "lunch",
  "quick side mission",
  "feeling sick",
  "day finish",
  "job finish",
] as const;

export type Status = (typeof STATUSES)[number];

export const LABEL: Record<Status, string> = {
  arrived: "Arrived on site",
  checkpoint: "Checkpoint",
  lunch: "Lunch break",
  "quick side mission": "Side mission",
  "feeling sick": "Feeling sick",
  "day finish": "Day finish",
  "job finish": "Job finish",
};

export const TERMINAL: readonly Status[] = ["day finish", "job finish"];
export const WORKING: readonly Status[] = ["arrived", "checkpoint"];
export const PAUSED: readonly Status[] = ["lunch", "quick side mission", "feeling sick"];

export type Phase = "off" | "on" | "break";

export const TOKEN_KEY = "jpay.deviceToken";
export const SIDE_MISSION_DURATIONS = [15, 30, 45, 60, 120] as const;

export function phaseOf(last?: { status: string }): Phase {
  if (!last) return "off";
  const s = last.status as Status;
  if (TERMINAL.includes(s)) return "off";
  if (WORKING.includes(s)) return "on";
  if (PAUSED.includes(s)) return "break";
  return "off";
}

export type CardLog = {
  _id: string;
  status: string;
  isWithinGeofence: boolean;
  impossibleTravelFlag?: boolean;
  siteId?: Id<"sites">;
  clientReportedTime?: number;
  _creationTime: number;
};

export type CardSite = {
  _id: Id<"sites">;
  name: string;
  latitude: number;
  longitude: number;
};
