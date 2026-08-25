export type JurisdictionCode = "ZA" | "US" | "UK";

export type JurisdictionStrategy = "bcea" | "flsa" | "wtr_uk";

export interface JurisdictionInfo {
  code: JurisdictionCode;
  strategy: JurisdictionStrategy;
  currency: string;
  currencySymbol: string;
  defaultTimezone: string;
  displayName: string;
}

export class UnsupportedJurisdictionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Unsupported jurisdiction: ${code}`);
    this.name = "UnsupportedJurisdictionError";
    this.code = code;
  }
}

const TABLE: Record<JurisdictionCode, JurisdictionInfo> = {
  ZA: {
    code: "ZA",
    strategy: "bcea",
    currency: "ZAR",
    currencySymbol: "R",
    defaultTimezone: "Africa/Johannesburg",
    displayName: "South Africa (BCEA)",
  },
  US: {
    code: "US",
    strategy: "flsa",
    currency: "USD",
    currencySymbol: "$",
    defaultTimezone: "America/New_York",
    displayName: "United States (FLSA)",
  },
  UK: {
    code: "UK",
    strategy: "wtr_uk",
    currency: "GBP",
    currencySymbol: "£",
    defaultTimezone: "Europe/London",
    displayName: "United Kingdom (WTR)",
  },
};

export function getPayStrategy(code: string): JurisdictionInfo {
  const up = code.toUpperCase() as JurisdictionCode;
  const row = TABLE[up];
  if (!row) throw new UnsupportedJurisdictionError(code);
  return row;
}

export function listSupportedJurisdictions(): JurisdictionInfo[] {
  return [TABLE.ZA, TABLE.US, TABLE.UK];
}
