import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    role: v.union(v.literal("moderator"), v.literal("employee")),
    isActive: v.boolean(),
    deviceId: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
    hourlyRateOverride: v.optional(v.number()),
    pushSubscriptionTokens: v.optional(v.array(v.string())),
  })
    .index("by_email", ["email"])
    .index("email", ["email"])
    .index("by_role", ["role"])
    .index("by_active", ["isActive"]),

  sites: defineTable({
    name: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    geofenceRadiusMeters: v.number(),
    timezone: v.string(),
    archivedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    updatedAt: v.optional(v.number()),
    updatedBy: v.optional(v.id("users")),
  }),

  userSites: defineTable({
    userId: v.id("users"),
    siteId: v.id("sites"),
  })
    .index("by_user", ["userId"])
    .index("by_site", ["siteId"]),

  logs: defineTable({
    userId: v.id("users"),
    siteId: v.id("sites"),
    clientReportedTime: v.number(),
    clockSkewMs: v.optional(v.number()),
    status: v.union(
      v.literal("arrived"),
      v.literal("checkpoint"),
      v.literal("lunch"),
      v.literal("feeling sick"),
      v.literal("day finish"),
      v.literal("job finish"),
      v.literal("quick side mission")
    ),
    latitude: v.number(),
    longitude: v.number(),
    accuracyMeters: v.number(),
    isWithinGeofence: v.boolean(),
    sideMissionDurationMinutes: v.optional(
      v.union(v.literal(15), v.literal(30), v.literal(45), v.literal(60), v.literal(120))
    ),
    deviceMetadata: v.string(),
    ipAddress: v.optional(v.string()),
    idempotencyKey: v.string(),
    isModeratorOverride: v.optional(v.boolean()),
    impossibleTravelFlag: v.optional(v.boolean()),
  })
    .index("by_user_time", ["userId", "_creationTime"])
    .index("by_status", ["status"])
    .index("by_site_time", ["siteId", "_creationTime"])
    .index("by_user_skew", ["userId", "clockSkewMs"]),

  shifts: defineTable({
    userId: v.id("users"),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    totalMinutes: v.optional(v.number()),
    needsReview: v.boolean(),
    reviewReason: v.optional(v.string()),
  })
    .index("by_user_start", ["userId", "startedAt"])
    .index("by_needs_review", ["needsReview"]),

  messages: defineTable({
    senderId: v.id("users"),
    recipientId: v.optional(v.id("users")),
    modQueue: v.boolean(),
    content: v.string(),
    isRead: v.boolean(),
    archivedAt: v.optional(v.number()),
    retentionDays: v.optional(v.number()),
  })
    .index("by_recipient_read", ["recipientId", "isRead"])
    .index("by_modqueue_unread", ["modQueue", "isRead"]),

  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    keysP256dh: v.string(),
    keysAuth: v.string(),
  }).index("by_user", ["userId"]),
});
