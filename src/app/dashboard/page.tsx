"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Retired: the logging dashboard is folded into the moderator console. */
export default function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/moderator");
  }, [router]);
  return (
    <main className="grid min-h-dvh place-items-center text-sm text-[var(--fog)]">Redirecting…</main>
  );
}
