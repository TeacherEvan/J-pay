"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";

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
      <main className="grid min-h-dvh place-items-center text-sm text-neutral-400">Loading…</main>
    );
  }

  if (!isAuthenticated || me === null || me.isAnonymous !== true || binding === null) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="max-w-sm text-center text-sm text-neutral-300">
          <p className="mb-3">Demo session is not active.</p>
          <Link href="/" className="text-emerald-400 underline">Back to sign-in</Link>
        </div>
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-800 pb-3">
        <div>
          <h1 className="text-xl font-semibold text-emerald-300">J-Pay · Demo console</h1>
          <p className="text-sm text-neutral-400">
            Reviewer <span className="text-neutral-200">{binding.reviewerName}</span> · playing as{" "}
            <span className="text-neutral-200" data-testid="demo-persona-name">{binding.personaName}</span>
            {recentCount !== undefined && (
              <> · {recentCount.length} log rows on file</>
            )}
          </p>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/demo/persona" className="text-emerald-400 underline">Switch persona</Link>
          <Link href="/demo/about" className="text-neutral-400 underline">About</Link>
          <button
            type="button"
            onClick={() => void signOut().then(() => router.replace("/"))}
            className="rounded-md border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            Exit demo
          </button>
        </nav>
      </header>
      {children}
      <footer className="mt-auto pt-8 text-sm leading-relaxed text-neutral-400">
        This is a demo. Seeded data; auto-purged after 7 days. The real product is unaffected.
      </footer>
    </div>
  );
}
