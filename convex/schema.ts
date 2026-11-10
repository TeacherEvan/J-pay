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
    isMasterTemp: v.optional(v.boolean()),
    role: v.union(v.literal("moderator"), v.literal("employee"), v.literal("manager")),
    isActive: v.boolean(),
    passwordChangedAt: v.optional(v.number()),
    deviceId: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
    hourlyRateOverride: v.optional(v.number()),
    pushSubscriptionTokens: v.optional(v.array(v.string())),
    payStrategy: v.optional(
      v.union(
        v.literal("flat"),
        v.literal("bcea"),
        v.literal("dailyOvertime"),
        v.literal("flsa"),
        v.literal("wtr_uk")
      )
    ),
    locale: v.optional(v.string()),
    travelConsentAt: v.optional(v.number()),
  })
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

  punches: defineTable({
    userId: v.id("users"),
    siteId: v.id("sites"),
    type: v.union(v.literal("in"), v.literal("out")),
    lat: v.number(),
    lng: v.number(),
    geoPassed: v.boolean(),
    ts: v.number(),
  })
    .index("by_user_site_time", ["userId", "siteId"]),

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
    createdByDemoReviewerId: v.optional(v.id("users")),
  })
    .index("by_user_time", ["userId"])
    .index("by_status", ["status"])
    .index("by_site_time", ["siteId"])
    .index("by_user_skew", ["userId", "clockSkewMs"])
    .index("by_user_idem", ["userId", "idempotencyKey"]),

  shifts: defineTable({
    userId: v.id("users"),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    totalMinutes: v.optional(v.number()),
    needsReview: v.boolean(),
    reviewReason: v.optional(v.string()),
    timezone: v.optional(v.string()),
    sealed: v.optional(v.boolean()),
  })
    .index("by_user_start", ["userId", "startedAt"])
    .index("by_started", ["startedAt"])
    .index("by_active", ["endedAt"])
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
    .index("by_modqueue_unread", ["modQueue", "isRead"])
    .index("by_sender", ["senderId"]),

  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    keysP256dh: v.string(),
    keysAuth: v.string(),
    lastErrorAt: v.optional(v.number()),
    consecutiveErrors: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  purgeAudit: defineTable({
    purgedAt: v.number(),
    purgedCount: v.number(),
    kind: v.union(v.literal("coordinates"), v.literal("messages"), v.literal("masterTemps")),
  }).index("by_purged_at", ["purgedAt"]),

  reviewResolutions: defineTable({
    userId: v.id("users"),
    shiftKey: v.string(),
    resolvedAt: v.number(),
    byModeratorId: v.id("users"),
  }).index("by_user_key", ["userId", "shiftKey"]),

  managerSites: defineTable({
    managerId: v.id("users"),
    siteId: v.id("sites"),
  })
    .index("by_manager", ["managerId"])
    .index("by_site", ["siteId"]),

  travelSegments: defineTable({
    userId: v.id("users"),
    fromSiteId: v.optional(v.id("sites")),
    toSiteId: v.optional(v.id("sites")),
    departedAt: v.number(),
    arrivedAt: v.optional(v.number()),
    distanceMeters: v.number(),
    maxSpeedMps: v.optional(v.number()),
    pathSamples: v.array(v.object({
      lat: v.number(),
      lng: v.number(),
      t: v.number(),
      s: v.optional(v.number()),
    })),
    lastFixKey: v.optional(v.string()),
    needsReview: v.boolean(),
    reviewReason: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_departed", ["departedAt"]),

  demoSessions: defineTable({
    reviewerId: v.id("users"),
    personaEmail: v.string(),
    mode: v.union(v.literal("employee"), v.literal("moderator"), v.literal("full")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_reviewer", ["reviewerId"])
    .index("by_persona", ["personaEmail"]),
});
