import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireModerator } from "./access";

function validName(name: string): string {
  const text = name.trim();
  if (!text || text.length > 100) throw new ConvexError("INVALID_NAME");
  return text;
}

/** Moderator-only: create an organisation. Sites are created under it afterwards. */
export const createOrg = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const moderatorId = await requireModerator(ctx);
    const name = validName(args.name);
    return await ctx.db.insert("organisations", { name, createdBy: moderatorId });
  },
});

/** Moderator-only: rename an organisation. */
export const renameOrg = mutation({
  args: { orgId: v.id("organisations"), name: v.string() },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const name = validName(args.name);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new ConvexError("ORG_NOT_FOUND");
    await ctx.db.patch(args.orgId, { name });
    return { ok: true as const };
  },
});

/** Moderator-only: archive (soft-delete) an organisation. Sites/users keep their link;
 *  archived orgs are hidden from pickers but their data remains for audit. */
export const archiveOrg = mutation({
  args: { orgId: v.id("organisations") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new ConvexError("ORG_NOT_FOUND");
    await ctx.db.patch(args.orgId, { archivedAt: Date.now() });
    return { ok: true as const };
  },
});

/** Moderator-only: list organisations with site/user counts for the console. */
export const listOrgs = query({
  args: {},
  handler: async (ctx) => {
    await requireModerator(ctx);
    const orgs = await ctx.db.query("organisations").collect();
    const live = orgs.filter((o) => o.archivedAt === undefined);
    // Per-org indexed counts instead of two full-table collects (audit
    // 2026-11-11, item 5). Orgs are few; per-org site/user sets are small.
    return (await Promise.all(live.map(async (o) => {
      const orgSites = await ctx.db.query("sites").withIndex("by_org", (q) => q.eq("orgId", o._id)).collect();
      const orgUsers = await ctx.db.query("users").withIndex("by_org", (q) => q.eq("orgId", o._id)).collect();
      return {
        _id: o._id,
        name: o.name,
        siteCount: orgSites.filter((s) => s.archivedAt === undefined).length,
        userCount: orgUsers.filter((u) => u.archivedAt === undefined).length,
      };
    }))).sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Internal (actions can't read the db): the org if it exists and is live. */
export const getActive = internalQuery({
  args: { id: v.id("organisations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.id);
    return org && org.archivedAt === undefined ? { _id: org._id, name: org.name } : null;
  },
});
