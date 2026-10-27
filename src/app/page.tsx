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
    return (
      <main className="grid min-h-dvh place-items-center text-sm text-[var(--fog)]">
        <div className="flex flex-col items-center gap-3">
          <svg className="jpay-loader-emblem h-10 w-10 text-[var(--mint)]" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2.5" strokeDasharray="6 4" />
            <circle cx="20" cy="20" r="6" fill="currentColor" />
          </svg>
          <span>Loading…</span>
        </div>
      </main>
    );
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
          <h1 className="text-xl font-bold tracking-tight text-[var(--paper)]">J-Pay</h1>
          <div className="flex items-center gap-2">
            {showInstall && (
              <button
                data-testid="pwa-install-cta"
                onClick={() => void installEvent.current?.prompt()}
                aria-label="Install J-Pay as a Progressive Web App"
                className="btn-surgical rounded-full border-[var(--mint)]/60 px-3 py-2 text-xs font-semibold text-[var(--mint)] hover:bg-[var(--mint)]/10"
              >
                Install app
              </button>
            )}
            {me.role === "employee" && <EnableNotifications />}
            <span className="rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider text-[var(--fog)]">
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
              className="min-h-[44px] rounded px-2.5 py-2 text-xs text-[var(--fog)] underline hover:text-[var(--paper)] transition"
            >
              Sign out
            </button>
          </div>
        </header>
        {isIos() && !iosDismissed && (
          <div className="card-subpanel flex items-start justify-between gap-3 p-3.5 text-sm text-[var(--fog)]">
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
              className="shrink-0 rounded p-1.5 text-[var(--fog)] hover:text-[var(--paper)]"
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
        <footer id="privacy" className="mt-auto pt-8 text-xs leading-relaxed text-[var(--fog)]">
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <div className="card-surgical max-w-sm p-6">
        <h2 id="consent-title" className="mb-3 text-lg font-bold text-[var(--paper)]">All work, no ads!</h2>
        <p className="mb-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          J-Pay records your GPS location and time only at your check-ins so your employer can run
          payroll accurately. Retention follows your local labor statute; raw coordinates are
          zeroed after the dispute window. Your data is never sold or used for advertising.
        </p>
        <p className="mb-4 text-xs leading-relaxed text-[var(--fog)]">
          See full details in our{" "}
          <a href="/privacy" className="text-[var(--mint)] underline hover:brightness-110">Privacy Policy</a>.
        </p>
        <button
          ref={acceptRef}
          data-testid="consent-acknowledge"
          onClick={onAccept}
          className="btn-surgical btn-surgical-mint w-full min-h-[44px] rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          I understand
        </button>
      </div>
    </div>
  );
}

function ModeratorHome() {
  return (
    <section className="card-surgical p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">
        Moderator
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
        You&apos;re running the floor. Check-ins happen on worker accounts — head to the console
        to provision, assign, and run payroll.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <a
          href="/moderator"
          className="btn-surgical btn-surgical-mint flex min-h-[44px] items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          Open moderator console →
        </a>
        <a
          href="/dashboard"
          className="btn-surgical flex min-h-[44px] items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium"
        >
          Logging dashboard →
        </a>
      </div>
    </section>
  );
}
