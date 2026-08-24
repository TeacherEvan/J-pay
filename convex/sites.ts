import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireActiveUser } from "./access";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const { userId, role } = await requireActiveUser(ctx);
    if (role === "moderator") {
      return await ctx.db.query("sites").collect();
    }
    const assignments = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const sites = [];
    for (const a of assignments) {
      const site = await ctx.db.get(a.siteId);
      if (site && site.archivedAt === undefined) sites.push(site);
    }
    return sites;
  },
});
