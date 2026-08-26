"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { SignIn } from "./sign-in";
import { MessagesPanel } from "./messages";
import { EnableNotifications } from "./notifications";
import { ChangePassword, ForcedPasswordChange } from "./change-password";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex } from "convex/react";
import { CheckInCard } from "./check-in-card";

const CONSENT_KEY = "jpay.consent";
const IOS_DISMISS_KEY = "jpay.iosInstallDismissed";

function isIos(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) &&
    !(window.navigator as unknown as { standalone?: boolean }).standalone
  );
}

export default function Home() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users_queries.me);
  const { signOut } = useAuthActions();
  const convex = useConvex();
  useEffect(() => {
    if (!isLoading && isAuthenticated && me === null) {
      void signOut().then(() => window.location.reload());
    }
  }, [isLoading, isAuthenticated, me, signOut]);
  const [consented, setConsented] = useState(true);
  const [iosDismissed, setIosDismissed] = useState(false);
  const installEvent = useRef<{ prompt: () => Promise<void> } | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    setConsented(localStorage.getItem(CONSENT_KEY) === "1");
    setIosDismissed(localStorage.getItem(IOS_DISMISS_KEY) === "1");
    const handler = (e: Event) => {
      e.preventDefault();
      installEvent.current = e as unknown as { prompt: () => Promise<void> };
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (isLoading) {
    return <main className="grid min-h-dvh place-items-center text-sm text-neutral-400">Loading…</main>;
  }
  if (!isAuthenticated || !me) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <SignIn />
      </main>
    );
  }

  const mustChangePassword = me.passwordChangedAt === undefined;

  return (
    <>
      {mustChangePassword && (
        <ForcedPasswordChange />
      )}
      {!consented && (
        <ConsentGate
          onAccept={() => {
            localStorage.setItem(CONSENT_KEY, "1");
            setConsented(true);
          }}
        />
      )}
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">J-Pay</h1>
          <div className="flex items-center gap-2">
            {showInstall && (
              <button
                data-testid="pwa-install-cta"
                onClick={() => void installEvent.current?.prompt()}
                aria-label="Install J-Pay as a Progressive Web App"
                className="rounded-full border border-emerald-500 px-3 py-2.5 text-sm text-emerald-300"
              >
                Install app
              </button>
            )}
            {me.role === "employee" && <EnableNotifications />}
            <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-sm uppercase tracking-wide">
              {me.role}
            </span>
            <button
              data-testid="auth-signout"
              onClick={async () => {
                try {
                  await convex.mutation(api.users.archiveMyMasterSession, {});
                } catch { /* ignore — best-effort archive */ }
                await signOut();
                window.location.reload();
              }}
              className="min-h-[44px] rounded text-xs text-neutral-500 px-2 py-2.5 underline hover:text-neutral-300"
            >
              Sign out
            </button>
          </div>
        </header>
        {isIos() && !iosDismissed && (
          <div className="flex items-start justify-between gap-2 rounded-md bg-neutral-900 p-3 text-sm text-neutral-400">
            <p>
              iPhone: add J-Pay to your Home Screen via Share → “Add to Home Screen”.
            </p>
            <button
              type="button"
              onClick={() => {
                setIosDismissed(true);
                localStorage.setItem(IOS_DISMISS_KEY, "1");
              }}
              aria-label="Dismiss iPhone install hint"
              className="shrink-0 rounded px-2 py-2.5 text-neutral-500 hover:text-neutral-200"
            >
              ✕
            </button>
          </div>
        )}
        {!mustChangePassword && (me.role === "employee" ? (
          <>
            <CheckInCard variant="live" />
            <MessagesPanel role="employee" />
            <ChangePassword />
          </>
        ) : (
          <ModeratorHome />
        ))}
        <footer id="privacy" className="mt-auto pt-8 text-sm leading-relaxed text-neutral-400">
          Location is recorded only when you press CHECK IN — never continuous tracking. Raw
          coordinates are anonymized after the payroll dispute window. No ads, no trackers.
        </footer>
      </main>
    </>
  );
}

function ConsentGate({ onAccept }: { onAccept: () => void }) {
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    acceptRef.current?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <div className="max-w-sm rounded-xl border border-neutral-800 bg-neutral-950 p-6">
        <h2 id="consent-title" className="mb-3 text-lg font-semibold">All work, no ads!</h2>
        <p className="mb-3 text-sm leading-relaxed text-neutral-300">
          J-Pay records your GPS location and time only at your check-ins so your employer can run
          payroll accurately. Retention follows your local labor statute; raw coordinates are
          zeroed after the dispute window. Your data is never sold or used for advertising.
        </p>
        {/* H9 (2026-08-26): surface the privacy notice inline so users can
            review data handling before consenting. */}
        <p className="mb-3 text-xs leading-relaxed text-neutral-500">
          See full details in our{" "}
          <a href="/privacy" className="underline hover:text-neutral-300">Privacy Policy</a>.
        </p>
        <button
          ref={acceptRef}
          data-testid="consent-acknowledge"
          onClick={onAccept}
          className="w-full min-h-[44px] rounded-md bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-emerald-950"
        >
          I understand
        </button>
      </div>
    </div>
  );
}

function ModeratorHome() {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">
        Moderator
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--fog)]">
        You&apos;re running the floor. Check-ins happen on worker accounts — head to the console
        to provision, assign, and run payroll.
      </p>
      <div className="mt-4 flex flex-col gap-1">
        <a
          href="/moderator"
          className="flex min-h-[44px] items-center rounded-lg bg-[var(--mint)] px-4 py-2.5 text-sm font-semibold text-emerald-950"
        >
          Open moderator console →
        </a>
        <a
          href="/dashboard"
          className="flex min-h-[44px] items-center rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm text-[var(--paper)]"
        >
          Logging dashboard →
        </a>
      </div>
    </section>
  );
}
