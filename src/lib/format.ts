const numberCache = new Map<string, Intl.NumberFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();

function nf(currency: string, locale: string): Intl.NumberFormat {
  const key = `${locale}::${currency}`;
  let f = numberCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });
    numberCache.set(key, f);
  }
  return f;
}

function df(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}::${JSON.stringify(opts)}`;
  let f = dateCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    dateCache.set(key, f);
  }
  return f;
}

export function formatCurrency(
  amount: number,
  currency: string,
  locale: string = "en-ZA"
): string {
  if (typeof Intl === "undefined" || !Intl.NumberFormat) {
    return `${currency} ${amount.toFixed(2)}`;
  }
  try {
    return nf(currency, locale).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatTime(
  epoch: number,
  locale: string = "en-ZA"
): string {
  if (typeof Intl === "undefined" || !Intl.DateTimeFormat) {
    return new Date(epoch).toLocaleTimeString();
  }
  try {
    return df(locale, { timeStyle: "short" }).format(new Date(epoch));
  } catch {
    return new Date(epoch).toLocaleTimeString();
  }
}

export function formatMinutesShort(m: number): string {
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return h > 0 ? `${h}h ${min.toString().padStart(2, "0")}m` : `${min}m`;
}

export function formatDateTime(
  epoch: number,
  locale: string = "en-ZA"
): string {
  if (typeof Intl === "undefined" || !Intl.DateTimeFormat) {
    return new Date(epoch).toLocaleString();
  }
  try {
    return df(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(epoch)
    );
  } catch {
    return new Date(epoch).toLocaleString();
  }
}

export function browserLocale(): string {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en-ZA";
}
