type JurisdictionCode = "ZA" | "US" | "UK";

type JurisdictionStrategy = "bcea" | "flsa" | "wtr_uk";

interface JurisdictionInfo {
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

const LOCALE_TO_CODE: Record<string, JurisdictionCode> = {
  "EN-ZA": "ZA",
  "EN-US": "US",
  "EN-GB": "UK",
  "GB": "UK",
};

export function getPayStrategy(code: string): JurisdictionInfo {
  const up = String(code ?? "").trim().toUpperCase();
  const direct = LOCALE_TO_CODE[up] ?? (up as JurisdictionCode);
  if (direct && TABLE[direct]) return TABLE[direct];
  if (up.includes("-")) {
    const parts = up.split("-");
    const region = parts[parts.length - 1];
    const mapped = (region === "GB" ? "UK" : region) as JurisdictionCode;
    if (TABLE[mapped]) return TABLE[mapped];
  }
  throw new UnsupportedJurisdictionError(code);
}

export function listSupportedJurisdictions(): JurisdictionInfo[] {
  return [TABLE.ZA, TABLE.US, TABLE.UK];
}
