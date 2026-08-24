export const jpayConfig = {
  client: {
    name: "J-Pay Field Operations",
    tagline: "GPS-Verified Workforce Attendance & Payroll",
    brandColor: "emerald",
  },
  laborRules: {
    maxShiftHours: 16,
    defaultLunchMinutes: 60,
    unpairedLunchThresholdMultiplier: 2,
    maxSideMissionMinutes: 120,
    skewToleranceMs: 30000,
  },
  geoRules: {
    maxAccuracyMeters: 50,
    impossibleTravelSpeedKmh: 200,
    defaultGeofenceRadiusMeters: 150,
    retentionDays: 90,
  },
  payrollRules: {
    standardWorkWeekHours: 45,
    overtimeMultiplier: 1.5,
    sundayMultiplier: 2.0,
    dailyOvertimeThresholdHours: 8,
    currency: "ZAR",
    currencySymbol: "R",
    strategy: "bcea" as "flat" | "bcea" | "dailyOvertime",
    defaultRate: 0,
  },
  defaultTimezone: "Africa/Johannesburg",
} as const;

export type JPayConfig = typeof jpayConfig;
