/** Shared moderator-console row types (kill the any-soup). */
export type ModeratorEmployee = {
  _id: string;
  role?: string;
  name?: string | null;
  email?: string | null;
  archivedAt?: number;
  isActive?: boolean;
  deviceId?: string;
  hourlyRateOverride?: number;
  locale?: string;
  orgId?: string;
  assignedSiteIds?: string[];
  siteNames?: string[];
};

export type AuditLogRow = {
  _id: string;
  at: number;
  employeeName: string;
  siteName: string;
  status: string;
  accuracyMeters: number;
  clockSkewMs: number;
  lat: number;
  lng: number;
  siteLat?: number;
  siteLng?: number;
  siteRadius?: number;
  isWithinGeofence: boolean;
  impossibleTravelFlag?: boolean;
};
