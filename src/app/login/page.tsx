"use client";

export const dynamic = "force-dynamic";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Retired: every role signs in on `/` (the old page listed employees to anonymous visitors). */
export default function LoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return (
    <main className="grid min-h-dvh place-items-center text-sm text-[var(--fog)]">Redirecting…</main>
  );
}
