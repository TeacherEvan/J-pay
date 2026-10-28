"use client";

import { useConvexAuth, useQuery } from "@/lib/backend/react";
import { useAuthActions } from "@/lib/backend/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/backend/api";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users_queries.me);
  const binding = useQuery(api.demo.getBinding, isAuthenticated ? {} : "skip");
  const recentCount = useQuery(api.demo.boundPersonaLogs, isAuthenticated ? {} : "skip");
  const { signOut } = useAuthActions();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || (me !== undefined && me !== null && me.isAnonymous !== true))) {
      void signOut().then(() => router.replace("/"));
    }
  }, [isLoading, isAuthenticated, me, signOut, router]);

  if (isLoading || me === undefined || binding === undefined) {
    return (
      <main className="grid min-h-dvh place-items-center text-sm text-[var(--paper-dim)]">
        <div className="flex flex-col items-center gap-4">
          <svg
            className="jpay-loader-emblem h-8 w-8 text-emerald-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span>Loading…</span>
        </div>
      </main>
    );
  }

  if (!isAuthenticated || me === null || me.isAnonymous !== true || binding === null) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="card-surgical max-w-sm p-6 text-center text-sm text-[var(--paper-dim)]">
          <p className="mb-4 text-[var(--paper)]">Demo session is not active.</p>
          <Link href="/" className="btn-surgical-mint inline-flex px-4 py-2 text-xs font-semibold uppercase tracking-wider">
            Back to sign-in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line)] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-emerald-400">J-Pay · Demo console</h1>
          <p className="text-xs text-[var(--paper-dim)]">
            Reviewer <span className="text-[var(--paper)] font-medium">{binding.reviewerName}</span> · playing as{" "}
            <span className="text-emerald-300 font-medium" data-testid="demo-persona-name">{binding.personaName}</span>
            {recentCount !== undefined && (
              <span className="tnum"> · {recentCount.length} log rows on file</span>
            )}
          </p>
        </div>
        <nav className="flex items-center gap-3 text-xs font-mono uppercase tracking-wider">
          <Link href="/demo/persona" className="text-emerald-400 hover:text-emerald-300 underline">Switch persona</Link>
          <Link href="/demo/about" className="text-[var(--paper-dim)] hover:text-[var(--paper)] underline">About</Link>
          <button
            type="button"
            onClick={() => void signOut().then(() => router.replace("/"))}
            className="btn-surgical rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-[var(--paper)]"
          >
            Exit demo
          </button>
        </nav>
      </header>
      {children}
      <footer className="mt-auto border-t border-[var(--line)] pt-4 text-xs font-mono text-[var(--paper-dimmer)]">
        This is a demo. Seeded data; auto-purged after 7 days. The real product is unaffected.
      </footer>
    </div>
  );
}
