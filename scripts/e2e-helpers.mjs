// scripts/e2e-helpers.mjs
//
// Shared e2e helpers for the J-Pay walkthrough scripts. Pure ESM, no TypeScript,
// no external runtime deps beyond puppeteer-core (already in devDependencies).
//
// Why this exists: scripts/e2e-full.mjs, scripts/e2e-demo.mjs,
// scripts/e2e-demo-rich.mjs (and the new e2e legs under development) all open a
// page, wire CDP, set geolocation, run a series of text/testid/URL waits, click
// buttons, and accumulate a pass/fail log. Before this file each script
// reinvented the same boilerplate; the third copy diverged (different ignore-
// lists, different wait loops) and the divergence was load-bearing. This module
// is the single source of truth for that boilerplate.
//
// Symbols (alphabetical):
//   attachErrorCapture(page, opts?)      — wire pageerror/console/requestfailed
//                                          capture, with the spec-mandated
//                                          ignore list (WebSocket failures,
//                                          RSC payload failures, ERR_ABORTED,
//                                          Fast Refresh, Convex control-plane)
//   assertJPayServed(page, baseUrl, opts?) — port-collision sentinel
//   cleanBeforeRun(dirs, opts?)          — remove old artefacts (default 24h)
//   clickByTestId(page, id, opts?)       — click an element by data-testid
//   clickByText(page, label, opts?)      — click a button/anchor containing text
//   createAssertions(opts?)              — returns { add, assert, summary, exitCode }
//                                          where add() records a step result
//                                          and assert() wraps a synchronous check
//                                          into add() with a step name
//   getTestIdText(page, id, opts?)       — read textContent of a data-testid
//   grantGeo(cdp, opts?)                 — Emulation.setGeolocationOverride +
//                                          Browser.grantPermissions; defaults
//                                          to JNB (-26.2041, 28.0473, ±20m)
//   preflight(page, opts?)               — env check + base URL check + J-Pay
//                                          sentinel; throws on any failure
//   requireEnv(names, opts?)             — early-exit with clear message
//   runWithBrowser(fn, opts?)            — single entry point: connect, grant
//                                          geo, attach error capture, clean
//                                          before run, run fn(page, helpers),
//                                          disconnect. Calls grantGeo +
//                                          attachErrorCapture + cleanBeforeRun
//                                          internally so callers do not have
//                                          to remember the order.
//   signIn(page, opts)                   — password sign-in; opts.step must be
//                                          'signIn' or 'signUp'; opts.dismiss
//                                          Consent=true clicks "I understand"
//                                          if it appears
//   waitFor(page, cond, opts?)           — generic condition poller. cond is
//                                          a function page => Promise<unknown>;
//                                          returns the first truthy result or
//                                          throws E2EWaitError on timeout.
//   waitForDownload(opts?)               — wait for a file in downloadDir to
//                                          match a regex and have minBytes;
//                                          settleMs silences the file-size
//                                          race when the browser has finished
//                                          writing
//   waitForSelector(page, sel, opts?)    — sugar over waitFor using a selector
//   waitForTestId(page, id, opts?)       — sugar over waitFor using data-testid
//   waitForText(page, regex, opts?)      — sugar over waitFor matching body text
//   waitForUrl(page, regex, opts?)       — sugar over waitFor matching page.url()
//
// All errors are thrown as plain Error subclasses with stable .name. Catch by
// the .name property rather than instanceof (works across module instances).

import puppeteer from "puppeteer-core";
import { readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Typed error subclasses (stable .name for cross-instance `err.name === ...`)
// ---------------------------------------------------------------------------

export class E2EWaitError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "E2EWaitError";
    this.detail = detail;
  }
}

export class E2EPreflightError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "E2EPreflightError";
    this.detail = detail;
  }
}

export class E2ESignInError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "E2ESignInError";
    this.detail = detail;
  }
}

export class E2EDownloadError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "E2EDownloadError";
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// JNB Central Depot coordinates. Same default across all scripts.
export const JNB = { lat: -26.2041, lng: 28.0473, accuracy: 20 };

// Chrome DevTools Protocol endpoint used by all scripts.
export const CDP_URL = process.env.JPAY_CDP_URL ?? "http://127.0.0.1:9300";

// Default base URL. Scripts can pass a different one to runWithBrowser.
const DEFAULT_BASE_URL = process.env.JPAY_BASE_URL ?? "http://localhost:3000";

// Default poll interval for waitFor* helpers.
const DEFAULT_POLL_MS = 500;

// Default per-call timeout for waitFor* helpers.
const DEFAULT_TIMEOUT_MS = 15_000;

// Default artefact retention for cleanBeforeRun (24h).
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

// Spec-mandated ignore list for attachErrorCapture. Any error matching one of
// these patterns is dropped before it counts as a script-level failure.
//
//   - WebSocket failures:  Convex keeps a long-lived WebSocket; the dev server
//     tears it down on hot reload, surfacing "WebSocket closed without opened"
//   - RSC payload failures: "Failed to fetch RSC payload" / "Error: aborted"
//     happens on every Next.js navigation; it's noise
//   - ERR_ABORTED:          fires on every cross-page navigation; not a real
//     error
//   - Fast Refresh:         next-dev's HMR surfaces "Fast Refresh had to
//     perform a full reload" on any state hook change; not a real error
//   - Convex control plane: status.convex.cloud, .convex.site/api/* — these
//     are infrastructure endpoints out of our control
const ERROR_IGNORE_PATTERNS = [
  /WebSocket closed without opened/i,
  /WebSocket connection to .* failed/i,
  /Failed to fetch RSC payload/i,
  /RSC payload/i,
  /ERR_ABORTED/i,
  /Fast Refresh had to perform a full reload/i,
  /\[Fast Refresh\]/i,
  /status\.convex\.cloud/i,
  /\.convex\.site\/api\//i,
  /\.convex\.cloud\/api\//i,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// requireEnv(names, opts?) — early-exit if any env var is unset
// ---------------------------------------------------------------------------

export function requireEnv(names, opts = {}) {
  const missing = names.filter((n) => !process.env[n] || process.env[n].length === 0);
  if (missing.length > 0) {
    const message = opts.message ?? `Missing required env: ${missing.join(", ")}`;
    if (opts.exit !== false) {
      console.error(message);
      process.exit(opts.exitCode ?? 2);
    }
    throw new E2EPreflightError(message, { missing });
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]]));
}

// ---------------------------------------------------------------------------
// grantGeo(cdp, opts?) — Emulation.setGeolocationOverride + grantPermissions
// ---------------------------------------------------------------------------

export async function grantGeo(cdp, opts = {}) {
  const coords = { ...JNB, ...(opts.coords ?? {}) };
  await cdp.send("Emulation.setGeolocationOverride", {
    latitude: coords.lat,
    longitude: coords.lng,
    accuracy: coords.accuracy,
  });
  if (opts.origin) {
    try {
      await cdp.send("Browser.grantPermissions", {
        permissions: ["geolocation"],
        origin: opts.origin,
      });
    } catch {
      // Some Chromium builds reject grantPermissions when the origin is not yet
      // trusted. Best-effort: the geolocation override above is the load-bearing
      // half of the call.
    }
  }
}

// ---------------------------------------------------------------------------
// attachErrorCapture(page, opts?) — capture pageerror/console/requestfailed
// ---------------------------------------------------------------------------

export function attachErrorCapture(page, opts = {}) {
  const errors = opts.errors ?? [];
  const dump = opts.dump ?? process.env.JPAY_DEBUG === "1";
  const ignore = [...(opts.ignore ?? []), ...ERROR_IGNORE_PATTERNS];

  const shouldIgnore = (text) => ignore.some((re) => re.test(text));

  page.on("pageerror", (e) => {
    const text = String(e).slice(0, 200);
    if (shouldIgnore(text)) return;
    errors.push(`pageerror: ${text}`);
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text().slice(0, 200);
    if (shouldIgnore(text)) return;
    errors.push(`console: ${text}`);
  });
  page.on("requestfailed", (r) => {
    const text = `${r.failure()?.errorText ?? "unknown"} ${r.url()}`;
    if (shouldIgnore(text)) return;
    errors.push(`requestfailed: ${text.slice(0, 200)}`);
  });

  return {
    errors,
    dump: async (label) => {
      if (!dump) return;
      try {
        const body = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
        console.log(`    [${label}]`, body.slice(0, 170));
      } catch {
        // page may be closed by this point; that's fine
      }
    },
  };
}

// ---------------------------------------------------------------------------
// cleanBeforeRun(dirs, opts?) — remove stale artefacts older than retention
// ---------------------------------------------------------------------------

export function cleanBeforeRun(dirs, opts = {}) {
  const retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
  const now = Date.now();
  for (const dir of [dirs].flat()) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = resolve(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const ageMs = now - st.mtimeMs;
      if (ageMs < retentionMs) continue;
      if (opts.matcher && !opts.matcher(name)) continue;
      try {
        rmSync(full, { force: true });
      } catch {
        // best effort
      }
    }
  }
}

// ---------------------------------------------------------------------------
// preflight(page, opts?) — env check + base URL + J-Pay sentinel
// ---------------------------------------------------------------------------

export async function preflight(page, opts = {}) {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  // The caller should have already called requireEnv; we do not re-check here.
  await page.goto(baseUrl + "/", { waitUntil: "networkidle2", timeout: 60_000 });

  const sentinel = opts.sentinel ?? /J-Pay/;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const t0 = Date.now();
  let body = "";
  while (Date.now() - t0 < timeoutMs) {
    body = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
    if (sentinel.test(body)) return { baseUrl, body };
    await sleep(DEFAULT_POLL_MS);
  }
  throw new E2EPreflightError(
    `${baseUrl} is not serving J-Pay (sentinel ${sentinel} not matched after ${timeoutMs}ms). ` +
      `Another app likely holds this port and J-pay auto-incremented — try JPAY_BASE_URL=http://localhost:3001.`,
    { baseUrl, body: body.slice(0, 200) },
  );
}

// ---------------------------------------------------------------------------
// assertJPayServed(page, baseUrl, opts?) — same sentinel, returns boolean
// ---------------------------------------------------------------------------

export async function assertJPayServed(page, baseUrl, opts = {}) {
  try {
    await preflight(page, { ...opts, baseUrl });
    return true;
  } catch (e) {
    if (e instanceof E2EPreflightError) return false;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// signIn(page, opts) — password sign-in
// ---------------------------------------------------------------------------

export async function signIn(page, opts) {
  const { email, password, step = "signIn", dismissConsent = true, baseUrl = DEFAULT_BASE_URL } = opts;
  if (!email || !password) {
    throw new E2ESignInError("signIn() requires opts.email and opts.password", { step });
  }
  if (step !== "signIn" && step !== "signUp") {
    throw new E2ESignInError(`signIn() opts.step must be 'signIn' or 'signUp' (got ${step})`, { step });
  }

  await page.goto(baseUrl + "/", { waitUntil: "networkidle2" });
  await sleep(1500);

  // Make sure the email field is present. If we landed on an authenticated
  // page the form is hidden; sign out and retry once.
  let hasEmail = await page.$('input[type="email"]');
  if (!hasEmail) {
    await page.reload({ waitUntil: "networkidle2" }).catch(() => {});
    await sleep(2000);
    hasEmail = await page.$('input[type="email"]');
  }
  if (!hasEmail) {
    throw new E2ESignInError(`signIn() could not find an email input on ${baseUrl}/`, { step });
  }

  // Fill email + password. Use the React-aware native setter dance so the
  // controlled inputs register the change.
  await page.evaluate(
    (emailVal) => {
      const el = document.querySelector('input[type="email"]');
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, emailVal);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    email,
  );
  await page.evaluate(
    (pwVal) => {
      const el = document.querySelector('input[type="password"]');
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, pwVal);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    password,
  );

  // Submit. Use the testid (added in this same change set) when available;
  // fall back to text match for callers that haven't recompiled.
  const submitted = await clickByTestId(page, `auth-submit-${step}`).catch(() => false);
  if (!submitted) {
    const label = step === "signIn" ? "Sign in" : "Activate account";
    await clickByText(page, label).catch(() => {});
  }
  await sleep(3000);

  if (dismissConsent) {
    // Click "I understand" up to 8 times (handles double-consent modals).
    for (let i = 0; i < 8; i++) {
      const ok = await clickByTestId(page, "consent-acknowledge").catch(() => false);
      if (!ok) break;
      await sleep(800);
    }
  }
}

// ---------------------------------------------------------------------------
// waitFor(page, cond, opts?) — generic condition poller
// ---------------------------------------------------------------------------

export async function waitFor(page, cond, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const t0 = Date.now();
  let lastResult = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      lastResult = await cond(page);
      if (lastResult) return lastResult;
    } catch {
      // cond may throw on transient DOM states; that's not a wait failure
    }
    await sleep(pollMs);
  }
  throw new E2EWaitError(
    opts.message ?? "waitFor() condition did not become truthy within timeout",
    { timeoutMs, lastResult },
  );
}

export async function waitForText(page, regex, opts = {}) {
  return waitFor(
    page,
    async (p) => {
      const t = await p.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
      return regex.test(t) ? t : null;
    },
    { ...opts, message: opts.message ?? `waitForText(${regex}) timed out` },
  );
}

export async function waitForTestId(page, id, opts = {}) {
  return waitFor(
    page,
    async (p) => p.evaluate((sel) => (document.querySelector(`[data-testid="${sel}"]`) ? true : null), id),
    { ...opts, message: opts.message ?? `waitForTestId(${id}) timed out` },
  );
}

export async function waitForUrl(page, regex, opts = {}) {
  return waitFor(
    page,
    async (p) => (regex.test(p.url()) ? p.url() : null),
    { ...opts, message: opts.message ?? `waitForUrl(${regex}) timed out` },
  );
}

export async function waitForSelector(page, sel, opts = {}) {
  return waitFor(
    page,
    async (p) => (await p.$(sel) ? true : null),
    { ...opts, message: opts.message ?? `waitForSelector(${sel}) timed out` },
  );
}

// ---------------------------------------------------------------------------
// clickByTestId / clickByText / getTestIdText
// ---------------------------------------------------------------------------

export async function clickByTestId(page, id, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result = await page.evaluate(
    (sel) => {
      const el = document.querySelector(`[data-testid="${sel}"]`);
      if (el && !el.disabled) {
        el.click();
        return true;
      }
      return false;
    },
    id,
  );
  if (!result && opts.required !== false) {
    // One short retry loop — the element may not have rendered yet.
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await sleep(DEFAULT_POLL_MS);
      const r = await page.evaluate(
        (sel) => {
          const el = document.querySelector(`[data-testid="${sel}"]`);
          if (el && !el.disabled) {
            el.click();
            return true;
          }
          return false;
        },
        id,
      );
      if (r) return true;
    }
    return false;
  }
  return result;
}

export async function clickByText(page, label, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probe = () =>
    page.evaluate((l) => {
      for (const sel of ["button", "a"]) {
        const el = [...document.querySelectorAll(sel)].find((x) => (x.textContent ?? "").includes(l));
        if (el && !el.disabled) {
          el.click();
          return true;
        }
      }
      return false;
    }, label);
  const first = await probe();
  if (first) return true;
  if (opts.required === false) return false;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(DEFAULT_POLL_MS);
    if (await probe()) return true;
  }
  return false;
}

export async function getTestIdText(page, id) {
  return page.evaluate((sel) => {
    const el = document.querySelector(`[data-testid="${sel}"]`);
    return el?.textContent?.trim() ?? "";
  }, id);
}

// ---------------------------------------------------------------------------
// waitForDownload(opts) — wait for a fresh file in downloadDir
// ---------------------------------------------------------------------------

export async function waitForDownload(opts) {
  const {
    downloadDir,
    matcher,
    minBytes = 1,
    settleMs = 500,
    timeoutMs = 30_000,
    before,
  } = opts;
  if (!downloadDir) {
    throw new E2EDownloadError("waitForDownload() requires opts.downloadDir");
  }
  if (!matcher) {
    throw new E2EDownloadError("waitForDownload() requires opts.matcher (regex or function)");
  }
  const isMatch = matcher instanceof RegExp ? (n) => matcher.test(n) : matcher;
  const beforeSet = before ?? new Set(readdirSync(downloadDir));
  const t0 = Date.now();
  let candidate = null;
  while (Date.now() - t0 < timeoutMs) {
    const files = readdirSync(downloadDir);
    const fresh = files.find((f) => isMatch(f) && !beforeSet.has(f));
    if (fresh) {
      const full = resolve(downloadDir, fresh);
      const st = statSync(full);
      if (st.size >= minBytes) {
        // Settle: confirm the file size stops changing.
        await sleep(settleMs);
        const st2 = statSync(full);
        if (st2.size === st.size) {
          return { path: full, size: st.size, name: fresh };
        }
      }
      candidate = { path: full, size: st.size, name: fresh };
    }
    await sleep(DEFAULT_POLL_MS);
  }
  throw new E2EDownloadError(
    `waitForDownload() did not find a file matching ${matcher} in ${downloadDir} within ${timeoutMs}ms`,
    { downloadDir, candidate },
  );
}

// ---------------------------------------------------------------------------
// createAssertions(opts?) — accumulates step results, returns a summary printer
// ---------------------------------------------------------------------------

export function createAssertions(opts = {}) {
  const results = [];
  const errors = opts.errors ?? [];
  const label = opts.label ?? "e2e";
  const dump = opts.dump ?? process.env.JPAY_DEBUG === "1";

  const add = async (step, ok, detail = "") => {
    results.push({ step, ok });
    console.log(`${ok ? "✓" : "✗"} ${step}${detail ? " — " + detail : ""}`);
    if (dump && opts.dumpPage) {
      try {
        const body = await opts.dumpPage.evaluate(() =>
          document.body.innerText.replace(/\n+/g, " | "),
        );
        console.log("    ", body.slice(0, 170));
      } catch {
        // page may have closed
      }
    }
  };

  // assert() wraps a synchronous predicate. Failures do not throw — they are
  // recorded as a failing step.
  const assert = (cond, step, detail = "") =>
    add(step, Boolean(cond), detail || (cond ? "" : "(failed)"));

  const summary = () => {
    const failed = results.filter((r) => !r.ok);
    console.log(
      `\n${label}: ${results.length - failed.length}/${results.length} steps passed`,
    );
    if (errors.length) {
      console.log("PAGE ERRORS:", [...new Set(errors)].slice(0, 8).join("\n  "));
    }
    return { total: results.length, failed: failed.length, results, errors };
  };

  const exitCode = () => {
    const failed = results.filter((r) => !r.ok).length;
    return failed === 0 && errors.length === 0 ? 0 : 1;
  };

  return { add, assert, summary, exitCode, results, errors };
}

// ---------------------------------------------------------------------------
// runWithBrowser(fn, opts?) — single entry point for the script lifecycle
// ---------------------------------------------------------------------------

export async function runWithBrowser(fn, opts = {}) {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const cdpUrl = opts.cdpUrl ?? CDP_URL;
  const downloadDir = opts.downloadDir;
  const screenshotDir = opts.screenshotDir;
  const cleanDirs = opts.cleanDirs ?? (screenshotDir ? [screenshotDir] : []);
  if (downloadDir) cleanDirs.push(downloadDir);
  const cleanOpts = opts.cleanOpts ?? { retentionMs: DEFAULT_RETENTION_MS };
  const assertions = createAssertions({
    label: opts.label,
    errors: [],
  });

  if (cleanDirs.length > 0) {
    cleanBeforeRun(cleanDirs, cleanOpts);
  }

  const browser = await puppeteer.connect({
    browserURL: cdpUrl,
    defaultViewport: null,
    protocolTimeout: 90_000,
  });
  // Close any pre-existing tabs so the script always starts with one clean page.
  for (const pg of await browser.pages()) {
    await pg.close().catch(() => {});
  }
  const page = await browser.newPage();
  const capture = attachErrorCapture(page, { errors: assertions.errors });
  const cdp = await page.createCDPSession();
  await grantGeo(cdp, { origin: baseUrl });
  if (downloadDir) {
    try {
      await cdp.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloadDir,
      });
    } catch {
      // Some Chromium builds reject this; CSV download will then fall back to
      // whatever the user configured in the page itself.
    }
  }

  try {
    await fn(page, { baseUrl, cdp, browser, capture, assertions, grantGeo, signIn });
  } finally {
    try {
      await page.close();
    } catch {
      // already closed
    }
    try {
      await browser.disconnect();
    } catch {
      // already disconnected
    }
  }

  const { total, failed } = assertions.summary();
  return { ...assertions, total, failed };
}
