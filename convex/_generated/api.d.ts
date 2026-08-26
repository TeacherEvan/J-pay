/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as changePassword from "../changePassword.js";
import type * as crons from "../crons.js";
import type * as demo from "../demo.js";
import type * as demo_scope from "../demo_scope.js";
import type * as demo_seed from "../demo_seed.js";
import type * as demo_sites from "../demo_sites.js";
import type * as deviceTokens from "../deviceTokens.js";
import type * as geo from "../geo.js";
import type * as geocode from "../geocode.js";
import type * as http from "../http.js";
import type * as kpi from "../kpi.js";
import type * as logs from "../logs.js";
import type * as messages from "../messages.js";
import type * as moderator from "../moderator.js";
import type * as payroll from "../payroll.js";
import type * as payroll_data from "../payroll_data.js";
import type * as push from "../push.js";
import type * as push_subs from "../push_subs.js";
import type * as shifts from "../shifts.js";
import type * as sites from "../sites.js";
import type * as users from "../users.js";
import type * as users_queries from "../users_queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  changePassword: typeof changePassword;
  crons: typeof crons;
  demo: typeof demo;
  demo_scope: typeof demo_scope;
  demo_seed: typeof demo_seed;
  demo_sites: typeof demo_sites;
  deviceTokens: typeof deviceTokens;
  geo: typeof geo;
  geocode: typeof geocode;
  http: typeof http;
  kpi: typeof kpi;
  logs: typeof logs;
  messages: typeof messages;
  moderator: typeof moderator;
  payroll: typeof payroll;
  payroll_data: typeof payroll_data;
  push: typeof push;
  push_subs: typeof push_subs;
  shifts: typeof shifts;
  sites: typeof sites;
  users: typeof users;
  users_queries: typeof users_queries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
