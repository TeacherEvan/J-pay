import { anyApi } from "convex/server";
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

const modules = {
  logs: null as unknown as typeof import("../logs"),
  sites: null as unknown as typeof import("../sites"),
  shifts: null as unknown as typeof import("../shifts"),
  users: null as unknown as typeof import("../users"),
  users_queries: null as unknown as typeof import("../users_queries"),
  moderator: null as unknown as typeof import("../moderator"),
  payroll: null as unknown as typeof import("../payroll"),
  messages: null as unknown as typeof import("../messages"),
  push_subs: null as unknown as typeof import("../push_subs"),
  payroll_data: null as unknown as typeof import("../payroll_data"),
  push: null as unknown as typeof import("../push"),
};

type PublicRef = FunctionReference<any, "public", any, any>;
type InternalRef = FunctionReference<any, "internal", any, any>;

export const api = anyApi as unknown as FilterApi<
  ApiFromModules<typeof modules>,
  PublicRef
>;
export const internal = anyApi as unknown as FilterApi<
  ApiFromModules<typeof modules>,
  InternalRef
>;
export const components = {};
