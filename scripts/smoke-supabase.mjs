#!/usr/bin/env node
/**
 * End-to-end smoke test of the Supabase-backed J-Pay backend.
 *
 * Proves the whole chain works on real data — Supabase Auth issues the session,
 * /api/backend/call authorises it, the Convex-shaped business logic runs
 * against Postgres, and the derived work (shifts, KPI, payroll) is consistent.
 *
 *   node scripts/smoke-supabase.mjs <moderator-email> <moderator-id-code> [base-url]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from
 * .env.local. Exits non-zero on the first failure.
 */
import { readFileSync } from "node:fs";

function loadEnv(path = ".env.local") {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const [email, password, baseArg] = process.argv.slice(2);
const BASE = baseArg ?? "http://127.0.0.1:3000";

if (!email || !password) {
  console.error("Usage: node scripts/smoke-supabase.mjs <moderator-email> <moderator-id-code> [base-url]");
  process.exit(1);
}

let passed = 0;
const failures = [];

function record(ok, label, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function signIn(who, secret) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify({ email: who, password: secret }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`sign-in failed for ${who}: ${JSON.stringify(body).slice(0, 200)}`);
  return { token: body.access_token, userId: body.user.id };
}

async function call(ref, args, token) {
  const response = await fetch(`${BASE}/api/backend/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ref, args: args ?? {} }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${ref} -> ${response.status} ${body.error ?? ""} ${body.message ?? ""}`.trim());
  }
  return body.result;
}

const stamp = Date.now();

try {
  console.log("\nJ-Pay / Supabase backend smoke test");
  console.log(`  target: ${BASE}\n`);

  /* --- 1. moderator session ------------------------------------------------ */
  const moderator = await signIn(email, password);
  const me = await call("users_queries:me", {}, moderator.token);
  record(me?.role === "moderator", "moderator session resolves users_queries:me", `role=${me?.role}`);

  /* --- 2. provision an employee ------------------------------------------- */
  const employeeEmail = `qa.employee.${stamp}@jpay.local`;
  const provision = await call(
    "users:provisionEmployee",
    { name: "QA Smoke Employee", email: employeeEmail },
    moderator.token
  );
  record(Boolean(provision?.idCode?.startsWith("JP-")), "provisionEmployee issues an ID code", provision?.idCode);

  /* --- 3. create + assign a site ------------------------------------------ */
  const siteId = await call(
    "sites:createSite",
    {
      name: `QA Site ${stamp}`,
      latitude: -25.7479,
      longitude: 28.2293,
      geofenceRadiusMeters: 150,
      timezone: "Africa/Johannesburg",
    },
    moderator.token
  );
  record(typeof siteId === "string", "createSite returns an id", siteId);

  const roster = await call("moderator:listEmployeesWithAssignments", {}, moderator.token);
  const created = roster.find((row) => row.email === employeeEmail);
  record(Boolean(created), "provisioned employee appears in the moderator roster", created?._id);

  await call("sites:assignEmployee", { userId: created._id, siteId }, moderator.token);
  const assigned = await call("sites:listMine", {}, moderator.token);
  record(
    assigned.some((site) => site._id === siteId),
    "assignEmployee links employee + site",
    `${assigned.length} site(s)`
  );

  /* --- 4. employee session, device token, punch, check-in ------------------ */
  const employee = await signIn(employeeEmail, provision.idCode);
  const deviceToken = await call("users:issueMyDeviceToken", {}, employee.token);
  record(typeof deviceToken === "string" && deviceToken.length > 20, "employee mints a device token");

  const punchSite = await call("sites:getSiteForPunch", {}, employee.token);
  record(punchSite?._id === siteId, "getSiteForPunch resolves the assigned site");

  const punch = await call(
    "punches:recordPunch",
    { siteId, type: "in", lat: -25.7479, lng: 28.2293, accuracyMeters: 8, deviceToken },
    employee.token
  );
  record(typeof punch?.punchId === "string", "recordPunch writes a punch", punch?.punchId);

  const logResult = await call(
    "logs:createLog",
    {
      siteId,
      clientReportedTime: Date.now(),
      status: "day finish",
      latitude: -25.7479,
      longitude: 28.2293,
      accuracyMeters: 8,
      deviceToken,
      idempotencyKey: `smoke-${stamp}`,
      deviceMetadata: "smoke-supabase",
    },
    employee.token
  );
  record(
    typeof logResult?.logId === "string" && logResult?.duplicate === false,
    "createLog writes an attendance entry",
    logResult?.logId
  );

  const history = await call("logs:listMine", {}, employee.token);
  record(history.length >= 1, "logs:listMine returns the entry", `${history.length} row(s)`);

  const punchHistory = await call("punches:getPunchHistory", { siteId }, employee.token);
  record(punchHistory.length >= 1, "punches:getPunchHistory returns the punch", `${punchHistory.length} row(s)`);

  /* --- 5. derived work: KPI ------------------------------------------- */
  const summary = await call("kpi:summary", {}, moderator.token);
  record(
    typeof summary?.activeOnSite === "number",
    "kpi:summary computes on Postgres",
    `activeOnSite=${summary?.activeOnSite} employees=${summary?.totalEmployees}`
  );

  /* --- 6. messages --------------------------------------------------------- */
  await call("messages:sendToModerators", { content: `Smoke test ${stamp}` }, employee.token);
  const inbox = await call("messages:moderatorInbox", {}, moderator.token);
  record(
    inbox.some((message) => String(message.content).includes(String(stamp))),
    "employee -> moderator message lands in the mod queue"
  );

  /* --- 7. payroll ---------------------------------------------------------- */
  const now = Date.now();
  const payroll = await call(
    "payroll:calcForEmployee",
    { userId: created._id, fromMs: now - 24 * 3600 * 1000, toMs: now + 3600 * 1000 },
    moderator.token
  );
  record(
    Number(payroll?.totals?.shiftCount) >= 1,
    "payroll:calcForEmployee derives shifts from the logs",
    `shiftCount=${payroll?.totals?.shiftCount} flagged=${payroll?.totals?.flaggedCount}`
  );

  const csv = await call(
    "payroll:exportLogsCsv",
    { userId: created._id, fromMs: now - 24 * 3600 * 1000, toMs: now + 3600 * 1000 },
    moderator.token
  );
  record(
    typeof csv?.csv === "string" && csv.csv.includes("client_time_utc") && csv.csv.includes("-25.7479"),
    "payroll:exportLogsCsv returns CSV with rows",
    `${String(csv?.csv ?? "").split("\r\n").length - 1} data row(s)`
  );
} catch (error) {
  failures.push(error.message);
  console.log(`  ERROR ${error.message}`);
}

console.log(`\n${failures.length === 0 ? "ALL CHECKS PASS" : `${failures.length} FAILURE(S)`}  (${passed} passed)`);
process.exit(failures.length === 0 ? 0 : 1);
