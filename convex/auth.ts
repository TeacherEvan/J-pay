import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = params.email as string | undefined;
        if (!email) throw new ConvexError("EMAIL_REQUIRED");
        return { email };
      },
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const db = (ctx as unknown as { db: MutationCtx["db"] }).db;
      if (args.existingUserId) return args.existingUserId;
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
