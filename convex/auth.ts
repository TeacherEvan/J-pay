import { Password } from "@convex-dev/auth/providers/Password";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { DEMO_SITES, DEMO_SITE_TIMEZONE } from "./demo_sites";

const demoEnabled = process.env.DEMO_MODE === "1";

/**
 * Constant-time string comparison to avoid timing side-channels when
 * comparing the master password from the request against the env var.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = params.email as string | undefined;
        if (!email) throw new ConvexError("EMAIL_REQUIRED");
        return { email };
      },
    }),
    ...(demoEnabled
      ? [
          Anonymous({
            profile() {
              return { isAnonymous: true, role: "employee", isActive: true };
            },
          }),
        ]
      : []),
    ConvexCredentials({
      id: "master",
      authorize: async (credentials, ctx) => {
        const masterPassword = process.env.MASTER_PASSWORD;
        if (!masterPassword) return null;
        const secret = credentials.secret as string | undefined;
        const email = credentials.email as string | undefined;
        if (!secret || !email) return null;
        if (!constantTimeEqual(secret, masterPassword)) return null;

        const normalized = email.toLowerCase().trim();

        // Dynamic import avoids a top-level import from _generated/api which
        // breaks the Node test runner's ts-ext-resolve chain (access → auth →
        // _generated/api.ts doesn't exist on disk).
        const { internal } = await import("./_generated/api");

        const existing = await ctx.runQuery(
          internal.users_queries.getByEmail,
          { email: normalized },
        );

        if (existing) {
          if (!existing.isActive || existing.archivedAt !== undefined) return null;
          return { userId: existing._id };
        }

        // Create a temporary moderator for this session; archived on sign-out.
        const userId = await ctx.runMutation(internal.users.createMasterTempUser, {
          email: normalized,
          name: normalized.split("@")[0],
        });
        return { userId };
      },
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const db = (ctx as unknown as { db: MutationCtx["db"] }).db;
      if (args.existingUserId) return args.existingUserId;
      if (args.profile.isAnonymous === true) {
        if (!demoEnabled) throw new ConvexError("DEMO_DISABLED");
        const userId = (await db.insert("users", {
          name: "Demo reviewer",
          role: "employee",
          isActive: true,
          isAnonymous: true,
          passwordChangedAt: Date.now(),
        })) as Id<"users">;
        let sites = await db
          .query("sites")
          .filter((q) => q.eq(q.field("archivedAt"), undefined))
          .collect();
        if (sites.length === 0) {
          for (const s of DEMO_SITES) {
            await db.insert("sites", {
              name: s.name,
              latitude: s.latitude,
              longitude: s.longitude,
              geofenceRadiusMeters: s.geofenceRadiusMeters,
              timezone: DEMO_SITE_TIMEZONE,
              createdBy: userId,
            });
          }
          sites = await db
            .query("sites")
            .filter((q) => q.eq(q.field("archivedAt"), undefined))
            .collect();
        }
        for (const site of sites) {
          await db.insert("userSites", { userId, siteId: site._id });
        }
        const now = Date.now();
        await db.insert("demoSessions", {
          reviewerId: userId,
          personaEmail: "thabo.demo@jpay.local",
          mode: "full",
          createdAt: now,
          updatedAt: now,
        });
        return userId;
      }
      const email = args.profile.email;
      if (!email) throw new ConvexError("EMAIL_REQUIRED");
      const existing = await db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      if (existing) {
        if (existing.archivedAt !== undefined) throw new ConvexError("ACCOUNT_ARCHIVED");
        return existing._id;
      }
      const role = (args.profile as { role?: unknown }).role;
      if (role === "employee" || role === "moderator") {
        return await db.insert("users", {
          name: (args.profile.name as string | undefined) ?? undefined,
          email,
          role: role === "moderator" ? "moderator" : "employee",
          isActive: true,
        });
      }
      throw new ConvexError("INVITE_REQUIRED");
    },
    async beforeSessionCreation(ctx, args) {
      const db = (ctx as unknown as { db: MutationCtx["db"] }).db;
      const user = await db.get(args.userId);
      if (!user || !user.isActive || user.archivedAt !== undefined) {
        throw new ConvexError("INACTIVE_ACCOUNT");
      }
    },
  },
});
