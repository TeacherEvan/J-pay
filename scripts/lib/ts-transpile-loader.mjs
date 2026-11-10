/**
 * Test-only ESM loader for the backend adapter audit harness.
 *
 * runtime.ts (and the convex/*.ts function bodies) use TypeScript parameter
 * properties, which Node's strip-only mode rejects. This loader transpiles
 * .ts/.tsx with the repo's own typescript package and resolves the handful of
 * paths the default resolver cannot reach, mapping them to zero-network stubs:
 *
 *   runtime.ts "./db"                -> scripts/lib/db-stub.mjs (in-memory, no Postgres)
 *   runtime.ts "@/lib/supabase/admin" -> throwing stub (no service-role client in tests)
 *   react.ts   "@/lib/supabase/client" -> scripts/lib/supabase-client-stub.mjs (fake session)
 *   "server-only"                    -> empty module
 *   "./_generated/<name>"            -> convex/_generated/<name>.js (repo-generated)
 *   "@/<path>"                       -> src/<path>(.ts|.tsx|/index.ts)
 *   relative extensionless imports    -> <spec>.ts|.tsx|.js|/index.ts
 *
 * Never resolves over the network. Never reads secrets beyond repo files.
 */
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const p = (...s) => path.join(ROOT, ...s);
const first = (...c) => c.find(existsSync);

export async function resolve(spec, context, next) {
  const gen = spec.match(/(?:^|\/)_generated\/(server|api|dataModel|client)$/);
  if (gen) return { url: "file://" + p("convex", "_generated", gen[1] + ".js"), shortCircuit: true };
  if (spec === "./db" && context.parentURL?.endsWith("/src/lib/backend/runtime.ts")) {
    return { url: "file://" + p("scripts", "lib", "db-stub.mjs"), shortCircuit: true };
  }
  if (spec === "@/lib/supabase/admin" && context.parentURL?.endsWith("runtime.ts")) {
    return {
      url: "data:text/javascript,export const hasSupabaseAdminKey=()=>false;export const createSupabaseAdminClient=()=>{throw new Error('test stub: no network')};",
      shortCircuit: true,
    };
  }
  if (spec === "@/lib/supabase/client" && context.parentURL?.endsWith("react.ts")) {
    return { url: "file://" + p("scripts", "lib", "supabase-client-stub.mjs"), shortCircuit: true };
  }
  if (spec === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (spec.startsWith("@/")) {
    const hit = first(p("src", spec.slice(2) + ".ts"), p("src", spec.slice(2) + ".tsx"), p("src", spec.slice(2), "index.ts"));
    if (hit) return { url: "file://" + hit, shortCircuit: true };
  }
  if (/^(\.|\.\.)\//.test(spec) && !/\.[cm]?[jt]sx?$/.test(spec)) {
    const base = new URL(spec, context.parentURL).pathname;
    const hit = first(base + ".ts", base + ".tsx", base + ".js", path.join(base, "index.ts"));
    if (hit) return { url: "file://" + hit, shortCircuit: true };
  }
  return next(spec, context);
}

export async function load(url, context, next) {
  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
        esModuleInterop: true,
      },
      fileName: path.basename(url),
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return next(url, context);
}
