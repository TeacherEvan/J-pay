import type {
  DocumentByName,
  GenericDataModel,
  GenericFieldPaths,
  SystemIndexes,
} from "convex/server";
import type { GenericId } from "convex/values";

export type TableNames =
  | "users"
  | "sites"
  | "userSites"
  | "logs"
  | "shifts"
  | "messages"
  | "pushSubscriptions"
  | "authSessions"
  | "authAccounts"
  | "authRefreshTokens"
  | "authVerificationCodes"
  | "authVerifiers"
  | "authRateLimits"
  | "reviewResolutions";

export type Id<TableName extends TableNames = TableNames> = GenericId<TableName>;

export interface DataModel extends GenericDataModel {
  users: {
    document: {
      _id: Id<"users">;
      _creationTime: number;
      name?: string;
      email?: string;
      emailVerificationTime?: number;
      phone?: string;
      phoneVerificationTime?: number;
      image?: string;
      isAnonymous?: boolean;
      role: "moderator" | "employee";
      isActive: boolean;
      deviceId?: string;
      archivedAt?: number;
      hourlyRateOverride?: number;
      pushSubscriptionTokens?: string[];
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & {
      by_email: ["email"];
      email: ["email"];
      by_role: ["role"];
      by_active: ["isActive"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  sites: {
    document: {
      _id: Id<"sites">;
      _creationTime: number;
      name: string;
      latitude: number;
      longitude: number;
      geofenceRadiusMeters: number;
      timezone: string;
      archivedAt?: number;
      createdBy: Id<"users">;
      updatedAt?: number;
      updatedBy?: Id<"users">;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes;
    searchIndexes: {};
    vectorIndexes: {};
  };
  userSites: {
    document: {
      _id: Id<"userSites">;
      _creationTime: number;
      userId: Id<"users">;
      siteId: Id<"sites">;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & { by_user: ["userId"]; by_site: ["siteId"] };
    searchIndexes: {};
    vectorIndexes: {};
  };
  logs: {
    document: {
      _id: Id<"logs">;
      _creationTime: number;
      userId: Id<"users">;
      siteId: Id<"sites">;
      clientReportedTime: number;
      clockSkewMs?: number;
      status:
        | "arrived"
        | "checkpoint"
        | "lunch"
        | "feeling sick"
        | "day finish"
        | "job finish"
        | "quick side mission";
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      isWithinGeofence: boolean;
      sideMissionDurationMinutes?: 15 | 30 | 45 | 60 | 120;
      deviceMetadata: string;
      ipAddress?: string;
      idempotencyKey: string;
      isModeratorOverride?: boolean;
      impossibleTravelFlag?: boolean;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & {
      by_user_time: ["userId", "_creationTime"];
      by_status: ["status"];
      by_site_time: ["siteId", "_creationTime"];
      by_user_skew: ["userId", "clockSkewMs"];
      by_user_idem: ["userId", "idempotencyKey"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  shifts: {
    document: {
      _id: Id<"shifts">;
      _creationTime: number;
      userId: Id<"users">;
      startedAt: number;
      endedAt?: number;
      totalMinutes?: number;
      needsReview: boolean;
      reviewReason?: string;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & {
      by_user_start: ["userId", "startedAt"];
      by_needs_review: ["needsReview"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  messages: {
    document: {
      _id: Id<"messages">;
      _creationTime: number;
      senderId: Id<"users">;
      recipientId?: Id<"users">;
      modQueue: boolean;
      content: string;
      isRead: boolean;
      archivedAt?: number;
      retentionDays?: number;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & {
      by_recipient_read: ["recipientId", "isRead"];
      by_modqueue_unread: ["modQueue", "isRead"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  pushSubscriptions: {
    document: {
      _id: Id<"pushSubscriptions">;
      _creationTime: number;
      userId: Id<"users">;
      endpoint: string;
      keysP256dh: string;
      keysAuth: string;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & { by_user: ["userId"] };
    searchIndexes: {};
    vectorIndexes: {};
  };
  reviewResolutions: {
    document: {
      _id: Id<"reviewResolutions">;
      _creationTime: number;
      userId: Id<"users">;
      shiftKey: string;
      resolvedAt: number;
      byModeratorId: Id<"users">;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & { by_user_key: ["userId", "shiftKey"] };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authSessions: {
    document: {
      _id: Id<"authSessions">;
      _creationTime: number;
      userId: Id<"users">;
      expirationTime: number;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & { userId: ["userId", "_creationTime"] };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authAccounts: {
    document: {
      _id: Id<"authAccounts">;
      _creationTime: number;
      secret?: string;
      emailVerified?: string;
      phoneVerified?: string;
      userId: Id<"users">;
      provider: string;
      providerAccountId: string;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & {
      userIdAndProvider: ["userId", "provider", "_creationTime"];
      providerAndAccountId: ["provider", "providerAccountId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authRefreshTokens: {
    document: {
      _id: Id<"authRefreshTokens">;
      _creationTime: number;
      firstUsedTime?: number;
      parentRefreshTokenId?: Id<"authRefreshTokens">;
      expirationTime: number;
      sessionId: Id<"authSessions">;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & {
      sessionId: ["sessionId", "_creationTime"];
      sessionIdAndParentRefreshTokenId: [
        "sessionId",
        "parentRefreshTokenId",
        "_creationTime"
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authVerificationCodes: {
    document: {
      _id: Id<"authVerificationCodes">;
      _creationTime: number;
      emailVerified?: string;
      phoneVerified?: string;
      verifier?: string;
      expirationTime: number;
      provider: string;
      accountId: Id<"authAccounts">;
      code: string;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & {
      accountId: ["accountId", "_creationTime"];
      code: ["code", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authVerifiers: {
    document: {
      _id: Id<"authVerifiers">;
      _creationTime: number;
      sessionId?: Id<"authSessions">;
      signature?: string;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & { signature: ["signature", "_creationTime"] };
    searchIndexes: {};
    vectorIndexes: {};
  };
  authRateLimits: {
    document: {
      _id: Id<"authRateLimits">;
      _creationTime: number;
      identifier: string;
      lastAttemptTime: number;
      attemptsLeft: number;
    };
    fieldPaths: GenericFieldPaths;
    indexes: SystemIndexes & { identifier: ["identifier", "_creationTime"] };
    searchIndexes: {};
    vectorIndexes: {};
  };
}

export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;
