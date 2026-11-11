import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireModerator, maybeCurrentUserId, orgBoundaryOk } from "./access";
import { isDemoUser } from "./demo/scope";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = MutationCtx | QueryCtx;

/**
 * B7 (2026-11-10): every manager power-grant writes an audit row BEFORE the
 * mutation commits. Budget rows go to `systemEvents` (kind manager_*), with a
 * JSON detail payload {actorId, action, targetUserId, before, after}.
 * Evidence survives even if a later step in the same mutation fails.
 */
async function auditManagerGrant(
  ctx: MutationCtx,
  entry: { actorId: Id<"users">; action: string; targetUserId: Id<"users">; before: string[]; after: string[] }
): Promise<void> {
  await ctx.db.insert("systemEvents", {
    kind: entry.action,
    userId: entry.targetUserId,
    at: Date.now(),
    detail: JSON.stringify(entry),
  });
}

/**
 * Manager role (owner 2026-11-10). A manager is a promoted employee with a
 * scoped console: they see the crew assigned to the sites in their
 * `managerSites` rows — employees (and managers) whose `userSites` assignments
 * overlap. Managers never get payroll-edit, provisioning or moderator admin
 * actions; promotion/demotion and site scoping are moderator-only.
 *
 * Live position comes from each crew member's latest log (same site-derivation
 * rule as the moderator Live crew map); continuous on-shift travel fixes land
 * in `travelSegments` (B-phase) and are merged in by `managedActiveShifts`.
 */

async function managedSiteIdSet(
  ctx: Ctx,
  managerId: Id<"users">
): Promise<Set<Id<"sites">>> {
  const rows = await ctx.db
    .query("managerSites")
    .withIndex("by_manager", (q) => q.eq("managerId", managerId))
    .collect();
  return new Set<Id<"sites">>(rows.filter((r) => r.archivedAt === undefined).map((r) => r.siteId));
}

/**
 * B8 (2026-11-10): crew lookup via the by_site index per managed site
 * instead of a full-table collect() of userSites on every hot call.
 */
export async function userIdsForSites(
  ctx: Ctx,
  siteIds: Set<Id<"sites">>
): Promise<Set<Id<"users">>> {
  const crew = new Set<Id<"users">>();
  for (const siteId of siteIds) {
    const rows = await ctx.db
      .query("userSites")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const r of rows) crew.add(r.userId);
  }
  return crew;
}

async function requireManagerViewer(
  ctx: Ctx
): Promise<{ managerId: Id<"users">; siteIds: Set<Id<"sites">> } | null> {
  const viewerId = await maybeCurrentUserId(ctx);
  if (!viewerId) return null;
  const viewer = await ctx.db.get(viewerId);
  // Never serve a demo persona a manager console; real managers only.
  if (!viewer || viewer.role !== "manager" || !viewer.isActive || viewer.archivedAt !== undefined) {
    return null;
  }
  if (isDemoUser(viewer)) return null;
  return { managerId: viewerId as Id<"users">, siteIds: await managedSiteIdSet(ctx, viewerId as Id<"users">) };
}

/** Sites the current manager covers (active, non-archived, not demo-provisioned). */
export const listManagedSites = query({
  args: {},
  handler: async (ctx) => {
    const scope = await requireManagerViewer(ctx);
    if (!scope) return [];
    const out = [];
    for (const siteId of scope.siteIds) {
      const site = await ctx.db.get(siteId);
      if (!site || site.archivedAt !== undefined) continue;
      const creator = await ctx.db.get(site.createdBy);
      if (creator && isDemoUser(creator)) continue;
      out.push(site);
    }
    out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return out;
  },
});

/**
 * Map payload: active shifts of crew assigned to managed sites.
 * Same site-derivation rule as the moderator map — the shift's site is the
 * employee's latest log site; no logs yet means no pin, never an invented one.
 * Returns [] to anyone who is not an active, real (non-demo) manager.
 */
export const managedActiveShifts = query({
  args: {},
  handler: async (ctx) => {
    const scope = await requireManagerViewer(ctx);
    if (!scope) return [];
    if (scope.siteIds.size === 0) return [];

    const crewSet = await userIdsForSites(ctx, scope.siteIds);
    const crewIds = new Set<string>(crewSet);
    if (crewIds.size === 0) return [];

    const active = await ctx.db
      .query("shifts")
      .withIndex("by_active", (q) => q.eq("endedAt", undefined))
      .collect();

    const out = [];
    for (const shift of active) {
      if (!crewIds.has(shift.userId)) continue;
      const user = await ctx.db.get(shift.userId);
      if (!user || isDemoUser(user) || !user.isActive || user.archivedAt !== undefined) continue;

      const lastLogs = await ctx.db
        .query("logs")
        .withIndex("by_user_time", (q) => q.eq("userId", shift.userId))
        .order("desc")
        .take(1);
      const lastLog = lastLogs[0] ?? null;
      const site = lastLog?.siteId ? await ctx.db.get(lastLog.siteId) : null;

      // Open travel leg? The live pin comes from the freshest off-site fix —
      // the employee is travelling, not "no GPS log yet".
      const legs = await ctx.db
        .query("travelSegments")
        .withIndex("by_user", (q) => q.eq("userId", shift.userId))
        .collect();
      const openLeg = legs.find((l) => l.arrivedAt === undefined);
      let travel: {
        segmentId: string;
        departedAt: number;
        distanceMeters: number;
        maxSpeedMps?: number;
        sampleCount: number;
        speedMps?: number;
      } | null = null;
      let pin = lastLog
        ? {
            lat: lastLog.latitude,
            lng: lastLog.longitude,
            accuracyMeters: lastLog.accuracyMeters,
            clientReportedTime: lastLog.clientReportedTime,
            status: lastLog.status as string,
            isWithinGeofence: lastLog.isWithinGeofence,
          }
        : null;
      if (openLeg) {
        const samples = (openLeg.pathSamples ?? []) as Array<{ lat: number; lng: number; t: number; s?: number }>;
        const lastSample = samples.length > 0 ? samples[samples.length - 1] : null;
        travel = {
          segmentId: openLeg._id,
          departedAt: openLeg.departedAt,
          distanceMeters: openLeg.distanceMeters,
          maxSpeedMps: openLeg.maxSpeedMps,
          sampleCount: samples.length,
          speedMps: lastSample?.s,
        };
        if (lastSample) {
          pin = {
            lat: lastSample.lat,
            lng: lastSample.lng,
            accuracyMeters: 0,
            clientReportedTime: lastSample.t,
            status: "travelling",
            isWithinGeofence: false,
          };
        }
      }

      out.push({
        _id: shift._id,
        userId: shift.userId,
        name: user.name ?? user.email ?? "unknown",
        startedAt: shift.startedAt,
        siteName: site?.name,
        siteLat: site?.latitude,
        siteLng: site?.longitude,
        siteRadiusMeters: site?.geofenceRadiusMeters,
        lastLog: pin,
        travel,
      });
    }
    out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return out;
  },
});

/** Roster for the manager console: crew, their sites, and live shift state. */
export const myCrew = query({
  args: {},
  handler: async (ctx) => {
    const scope = await requireManagerViewer(ctx);
    if (!scope) return [];

    const userSiteNames = new Map<string, string[]>();
    for (const siteId of scope.siteIds) {
      const site = await ctx.db.get(siteId);
      if (!site || site.archivedAt !== undefined) continue;
      const rows = await ctx.db
        .query("userSites")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .collect();
      for (const a of rows) {
      const list = userSiteNames.get(a.userId) ?? [];
      list.push(site.name);
      userSiteNames.set(a.userId, list);
      }
    }

    const active = await ctx.db
      .query("shifts")
      .withIndex("by_active", (q) => q.eq("endedAt", undefined))
      .collect();
    const openByUser = new Map<string, { _id: string; startedAt: number }>();
    for (const s of active) openByUser.set(s.userId, { _id: s._id, startedAt: s.startedAt });

    const out = [];
    for (const [userId, names] of userSiteNames) {
      const user = await ctx.db.get(userId as Id<"users">);
      if (!user || isDemoUser(user) || !user.isActive || user.archivedAt !== undefined) continue;
      out.push({
        _id: user._id,
        name: user.name ?? user.email ?? "unknown",
        email: user.email,
        role: user.role,
        assignedSiteNames: [...new Set(names)].sort(),
        onShift: openByUser.get(userId) ?? null,
      });
    }
    out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return out;
  },
});

/** Moderator: list promoted managers with their managed sites. */
export const listManagers = query({
  args: {},
  handler: async (ctx) => {
    const modId = await maybeCurrentUserId(ctx);
    if (!modId) return [];
    const mod = await ctx.db.get(modId);
    if (!mod || mod.role !== "moderator" || !mod.isActive || mod.archivedAt !== undefined) return [];

    const managers = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "manager"))
      .collect();
    const out = [];
    for (const m of managers) {
      if (isDemoUser(m) || m.archivedAt !== undefined) continue;
      const rows = (
        await ctx.db
          .query("managerSites")
          .withIndex("by_manager", (q) => q.eq("managerId", m._id))
          .collect()
      ).filter((r) => r.archivedAt === undefined);
      const names: string[] = [];
      const siteIds: string[] = [];
      for (const r of rows) {
        const site = await ctx.db.get(r.siteId);
        if (site && site.archivedAt === undefined) {
          siteIds.push(site._id);
          names.push(site.name);
        }
      }
      out.push({
        _id: m._id,
        name: m.name,
        email: m.email,
        isActive: m.isActive,
        managedSiteIds: siteIds,
        managedSiteNames: names.sort(),
      });
    }
    out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return out;
  },
});

/** Moderator: replace a manager's managed-site set transactionally. */
export const setManagerSites = mutation({
  args: {
    managerId: v.id("users"),
    siteIds: v.array(v.id("sites")),
  },
  handler: async (ctx, args) => {
    const actorId = await requireModerator(ctx);
    const manager = await ctx.db.get(args.managerId);
    if (!manager || manager.role !== "manager") throw new ConvexError("NOT_A_MANAGER");
    if (manager.archivedAt !== undefined || !manager.isActive) throw new ConvexError("ACCOUNT_INACTIVE");
    if (isDemoUser(manager)) throw new ConvexError("FORBIDDEN");

    const uniqueSiteIds = [...new Set(args.siteIds)];
    const wanted = new Set<string>();
    for (const siteId of uniqueSiteIds) {
      const site = await ctx.db.get(siteId);
      if (!site) throw new ConvexError("SITE_NOT_FOUND");
      if (site.archivedAt !== undefined) throw new ConvexError("SITE_ARCHIVED");
      if (!orgBoundaryOk(manager.orgId, site.orgId)) {
        throw new ConvexError("CROSS_ORG_SITE_ASSIGNMENT_FORBIDDEN");
      }
      wanted.add(siteId);
    }
    const allRows = await ctx.db
      .query("managerSites")
      .withIndex("by_manager", (q) => q.eq("managerId", args.managerId))
      .collect();
    const existing = allRows.filter((r) => r.archivedAt === undefined);
    const archived = allRows.filter((r) => r.archivedAt !== undefined);
    // B7: audit the grant BEFORE any write so evidence survives a mid-mutation failure.
    await auditManagerGrant(ctx, {
      actorId,
      action: "manager_sites_set",
      targetUserId: args.managerId,
      before: existing.map((r) => String(r.siteId)),
      after: [...wanted].map(String),
    });
    let unassigned = 0;
    for (const row of existing) {
      if (!wanted.has(row.siteId)) {
        await ctx.db.patch(row._id, { archivedAt: Date.now() }); // archive, never delete
        unassigned++;
      }
    }
    const activeIds = new Set(existing.map((r) => r.siteId as string));
    const archivedBySite = new Map(archived.map((r) => [String(r.siteId), r]));
    let assigned = 0;
    for (const siteId of wanted) {
      if (activeIds.has(siteId)) continue;
      const revivable = archivedBySite.get(siteId);
      if (revivable) {
        await ctx.db.patch(revivable._id, { archivedAt: undefined }); // revive the evidence row
        assigned++;
        continue;
      }
      await ctx.db.insert("managerSites", {
        managerId: args.managerId,
        siteId: siteId as Id<"sites">,
      });
      assigned++;
    }
    return { assigned, unassigned, total: wanted.size as number };
  },
});

/** Moderator: promote an employee to manager (same account, no new login). */
export const promoteToManager = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const actorId = await requireModerator(ctx);
    const actor = await ctx.db.get(actorId);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("USER_NOT_FOUND");
    if (target.role !== "employee") {
      if (target.role === "manager") return { ok: true as const, already: true as const };
      throw new ConvexError("NOT_AN_EMPLOYEE");
    }
    if (target.archivedAt !== undefined || !target.isActive) throw new ConvexError("ACCOUNT_INACTIVE");
    if (isDemoUser(target)) throw new ConvexError("FORBIDDEN");

    // Org boundary check (fail closed): both parties must agree on the org —
    // same org, or both unscoped. Exactly one side org'd, or different orgs → refuse.
    if (!orgBoundaryOk(actor?.orgId, target.orgId)) {
      throw new ConvexError("CROSS_ORG_PROMOTION_FORBIDDEN");
    }

    // Mid-shift lock: Check if target employee has an active open shift
    const userShifts = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) => q.eq("userId", args.userId))
      .collect();
    const hasOpenShift = userShifts.some((s) => s.endedAt === undefined);
    if (hasOpenShift) {
      throw new ConvexError("ACTIVE_SHIFT_IN_PROGRESS");
    }

    await auditManagerGrant(ctx, {
      actorId,
      action: "manager_promoted",
      targetUserId: args.userId,
      before: ["employee"],
      after: ["manager"],
    });

    // Site inheritance on promotion: automatically seed managerSites from employee's userSites
    const userSiteRows = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Query existing managerSites rows for reviving or skipping
    const existingManagerSites = await ctx.db
      .query("managerSites")
      .withIndex("by_manager", (q) => q.eq("managerId", args.userId))
      .collect();
    const activeMgrSites = new Set(
      existingManagerSites.filter((r) => r.archivedAt === undefined).map((r) => r.siteId as string)
    );
    const archivedMgrSitesBySite = new Map(
      existingManagerSites.filter((r) => r.archivedAt !== undefined).map((r) => [String(r.siteId), r])
    );

    for (const us of userSiteRows) {
      const site = await ctx.db.get(us.siteId);
      if (!site || site.archivedAt !== undefined) continue;
      // Cross-org guard: never inherit a site from another org (or a scoped site
      // for an unscoped target, or vice versa).
      if (!orgBoundaryOk(target.orgId, site.orgId)) continue;
      const sId = String(us.siteId);
      if (activeMgrSites.has(sId)) continue;
      const revivable = archivedMgrSitesBySite.get(sId);
      if (revivable) {
        await ctx.db.patch(revivable._id, { archivedAt: undefined });
      } else {
        await ctx.db.insert("managerSites", {
          managerId: args.userId,
          siteId: us.siteId,
        });
      }
      activeMgrSites.add(sId);
    }

    await ctx.db.patch(args.userId, { role: "manager" });
    return { ok: true as const, already: false as const };
  },
});

/** Moderator: demote a manager back to employee (drops managed-site rows). */
export const demoteManager = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const actorId = await requireModerator(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("USER_NOT_FOUND");
    if (target.role !== "manager") {
      if (target.role === "employee") return { ok: true as const, already: true as const };
      throw new ConvexError("NOT_A_MANAGER");
    }
    const rows = await ctx.db
      .query("managerSites")
      .withIndex("by_manager", (q) => q.eq("managerId", args.userId))
      .collect();
    const activeRows = rows.filter((r) => r.archivedAt === undefined);
    await auditManagerGrant(ctx, {
      actorId,
      action: "manager_demoted",
      targetUserId: args.userId,
      before: activeRows.map((r) => String(r.siteId)),
      after: [],
    });

    // Demotion safeguards: find any assigned sites where this manager is the sole active manager
    const orphanSiteIds: string[] = [];
    for (const row of activeRows) {
      const siteManagers = await ctx.db
        .query("managerSites")
        .withIndex("by_site", (q) => q.eq("siteId", row.siteId))
        .collect();
      // Active managers on this site other than the one being demoted
      let otherActiveCount = 0;
      for (const sm of siteManagers) {
        if (sm.managerId !== args.userId && sm.archivedAt === undefined) {
          const mUser = await ctx.db.get(sm.managerId);
          if (mUser && mUser.role === "manager" && mUser.isActive && mUser.archivedAt === undefined && !isDemoUser(mUser)) {
            otherActiveCount++;
          }
        }
      }
      if (otherActiveCount === 0) {
        orphanSiteIds.push(String(row.siteId));
      }
    }

    if (orphanSiteIds.length > 0) {
      await ctx.db.insert("systemEvents", {
        kind: "manager_demoted_orphan_sites",
        userId: args.userId,
        at: Date.now(),
        detail: JSON.stringify({
          actorId,
          managerId: args.userId,
          orphanSiteIds,
        }),
      });
    }

    for (const row of activeRows) await ctx.db.patch(row._id, { archivedAt: Date.now() }); // archive, never delete
    await ctx.db.patch(args.userId, { role: "employee" });
    return { ok: true as const, already: false as const };
  },
});

/** Scoping helper shared with the travel module: site ids managed by a manager. */
export async function managedSiteIds(
  ctx: Ctx,
  managerId: Id<"users">
): Promise<Set<Id<"sites">>> {
  return managedSiteIdSet(ctx, managerId);
}
