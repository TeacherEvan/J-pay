"use node";

/**
 * H8 (2026-08-26): server-side Nominatim proxy. The browser cannot set a
 * custom User-Agent (forbidden header), so geocoding requests must go
 * through a Convex action that sends proper identifying headers per the
 * Nominatim usage policy.
 */
import { action } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

export const geocode = action({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    // Only the moderator console geocodes. A public action here turns the
    // deployment into an anonymous Nominatim proxy and breaks its usage policy.
    const callerId = await getAuthUserId(ctx);
    if (!callerId) throw new ConvexError("UNAUTHENTICATED");
    const caller = await ctx.runQuery(internal.users_queries.getById, { id: callerId });
    if (!caller || caller.role !== "moderator" || !caller.isActive || caller.archivedAt !== undefined) {
      throw new ConvexError("FORBIDDEN");
    }
    const q = args.query.trim();
    if (q.length < 3) throw new ConvexError("QUERY_TOO_SHORT");
    if (q.length > 200) throw new ConvexError("QUERY_TOO_LONG");
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "5");
    url.searchParams.set("q", q);
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "J-Pay/1.0 (https://github.com/jpay; support@jpay.example)",
        "Accept-Language": "en",
      },
    });
    if (!res.ok) throw new ConvexError("NOMINATIM_ERROR");
    return await res.json();
  },
});
