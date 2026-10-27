import { NextResponse } from "next/server";
import {
  describeSupabaseEnv,
  hasSupabaseEnv,
} from "@/lib/supabase/env";
import { createSupabaseAnonClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient, hasSupabaseAdminKey } from "@/lib/supabase/admin";

/**
 * GET /api/health/supabase
 *
 * Real end-to-end proof that this deployment is linked to the Supabase
 * project: it performs live calls with both the publishable and the
 * service-role keys instead of just echoing env variables.
 *
 *   200  publishable key reached the project
 *   503  not configured, or the publishable key was rejected
 *
 * Never returns key material — see describeSupabaseEnv().
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Probe = {
  ok: boolean;
  latencyMs: number;
  detail?: string;
  error?: string;
};

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

async function timed(fn: () => Promise<string>): Promise<Probe> {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    return { ok: true, latencyMs: Date.now() - startedAt, detail };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: errorMessage(err) };
  }
}

export async function GET() {
  const env = describeSupabaseEnv();

  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      {
        linked: false,
        env,
        message:
          "Supabase env vars are missing. Add NEXT_PUBLIC_SUPABASE_URL and " +
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local and restart the dev server.",
      },
      { status: 503 }
    );
  }

  const publishable = await timed(async () => {
    const supabase = createSupabaseAnonClient();
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    return `storage reachable, ${data.length} bucket(s)`;
  });

  const service = hasSupabaseAdminKey()
    ? await timed(async () => {
        const admin = createSupabaseAdminClient();
        const { data, error } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1,
        });
        if (error) throw error;
        return `auth reachable, ${data.users.length} user(s) sampled`;
      })
    : ({ ok: false, latencyMs: 0, error: "no server key configured (skipped)" } as Probe);

  const linked = publishable.ok;

  return NextResponse.json(
    {
      linked,
      env,
      probes: { publishable, serviceRole: service },
      checkedAt: new Date().toISOString(),
    },
    { status: linked ? 200 : 503 }
  );
}
