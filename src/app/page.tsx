"use client";

import { useConvexAuth, useQuery, useMutation } from "@/lib/backend/react";
import { storageGet, storageSet, sessionGet, sessionSet, sessionRemove } from "@/lib/safe-storage";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/backend/api";
import { SignIn } from "./sign-in";
import { MessagesPanel } from "./messages";
import { FocusTrapModal } from "@/components/console/focus-trap-modal";
import { EnableNotifications } from "./notifications";
import { ChangePassword, ForcedPasswordChange, PW_CHANGED_KEY } from "./change-password";
import { useAuthActions } from "@/lib/backend/react";
import { useConvex } from "@/lib/backend/react";
import { CheckInCard } from "./check-in-card";
import { errMsg } from "@/lib/errors";

const CONSENT_KEY = "jpay.consent";
const IOS_DISMISS_KEY = "jpay.iosInstallDismissed";
const TRAVEL_SNOOZE_KEY = "jpay.travelDisclaimerSnoozedAt";
const TRAVEL_SNOOZE_MS = 7 * 24 * 3600 * 1000;

function isIos(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) &&
    !(window.navigator as unknown as { standalone?: boolean }).standalone
  );
}

export default function Home() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  // Skip while signed out so `me === null` only ever means "the post-login
  // query settled to null" — never the stale pre-sign-in settle, which used
  // to trigger the auto-sign-out effect right after credentials flipped true
  // and bounced people back to the login screen.
  const me = useQuery(api.users_queries.me, isAuthenticated ? {} : "skip");
  const { signOut } = useAuthActions();
  const convex = useConvex();
  useEffect(() => {
    if (!isLoading && isAuthenticated && me === null) {
      void signOut().then(() => window.location.reload());
    }
  }, [isLoading, isAuthenticated, me, signOut]);
  // Tri-state: null = localStorage not read yet — never flash gated content
  // for an unconsented user, never flash the gate for a consented one.
  const [consented, setConsented] = useState<boolean | null>(null);
  const [iosDismissed, setIosDismissed] = useState(false);
  const [installAsked, setInstallAsked] = useState(false);
  const [travelSnoozed, setTravelSnoozed] = useState(false);
  const [ackBusy, setAckBusy] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const installEvent = useRef<{ prompt: () => Promise<void> } | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const ackTravel = useMutation(api.travel.setConsent);

  useEffect(() => {
    try {
      const snoozed = Number(storageGet(TRAVEL_SNOOZE_KEY) ?? 0);
      setTravelSnoozed(Number.isFinite(snoozed) && Date.now() - snoozed < TRAVEL_SNOOZE_MS);
    } catch { /* storage unavailable */ }
  }, []);

  // One-time install request right after a forced first-login password change.
  useEffect(() => {
    try {
      if (sessionGet(PW_CHANGED_KEY)) {
        sessionRemove(PW_CHANGED_KEY);
        setInstallAsked(true);
      }
    } catch { /* sessionStorage unavailable */ }
  }, []);

  useEffect(() => {
    setConsented(storageGet(CONSENT_KEY) === "1");
    setIosDismissed(storageGet(IOS_DISMISS_KEY) === "1");
    const handler = (e: Event) => {
      e.preventDefault();
      installEvent.current = e as unknown as { prompt: () => Promise<void> };
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (consented === null) {
    return (
      <main className="grid min-h-dvh place-items-center text-sm text-[var(--fog)]">
        <span>Loading…</span>
      </main>
    );
  }

  if (isLoading || (isAuthenticated && me === undefined)) {
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
  const travelConsentAt = (me as unknown as { travelConsentAt?: number | null }).travelConsentAt;
  const travelAckNeeded =
    me.role !== "moderator" &&
    me.passwordChangedAt !== undefined &&
    travelConsentAt == null &&
    !travelSnoozed;

  return (
    <>
      {mustChangePassword && (
        <ForcedPasswordChange />
      )}
      {!mustChangePassword && consented && installAsked && (
        <InstallRequestModal
          isIos={isIos()}
          canInstall={showInstall}
          onInstall={() => {
            void installEvent.current?.prompt();
            setInstallAsked(false);
          }}
          onDone={() => setInstallAsked(false)}
        />
      )}
      {!mustChangePassword && consented && !installAsked && travelAckNeeded && (
        <TravelDisclaimerModal
          busy={ackBusy}
          error={ackError}
          onDefer={() => {
            try {
              storageSet(TRAVEL_SNOOZE_KEY, String(Date.now()));
            } catch { /* storage unavailable — modal just won't persist the snooze */ }
            setTravelSnoozed(true);
          }}
          onAck={() => {
            setAckBusy(true);
            setAckError(null);
            ackTravel({ consent: true })
              .catch((e: unknown) => setAckError(errMsg(e)))
              .finally(() => setAckBusy(false));
          }}
        />
      )}
      {!consented && (
        <ConsentGate
          onAccept={() => {
            storageSet(CONSENT_KEY, "1");
            setConsented(true);
          }}
        />
      )}
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
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
            {me.role !== "moderator" && <EnableNotifications />}
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
                storageSet(IOS_DISMISS_KEY, "1");
              }}
              aria-label="Dismiss iPhone install hint"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-lg text-[var(--fog)] hover:text-[var(--paper)]"
            >
              ✕
            </button>
          </div>
        )}
        {!mustChangePassword && (me.role === "moderator" ? (
          <ModeratorHome />
        ) : (
          <>
            <CheckInCard variant="live" />
            {me.role === "manager" && <ManagerCard />}
            <MessagesPanel role="employee" />
            <ChangePassword />
          </>
        ))}
        <footer id="privacy" className="mt-auto pt-8 text-xs leading-relaxed text-[var(--fog)]">
          Location is recorded when you press CHECK IN, and automatically while your shift clock
          is running (never off shift, never during lunch or side missions) so your manager can
          see travel between sites. Raw coordinates are anonymized after the payroll dispute
          window. No ads, no trackers.
        </footer>
      </main>
    </>
  );
}

function ConsentGate({ onAccept }: { onAccept: () => void }) {
  return (
    <FocusTrapModal labelledBy="consent-title" overlayClassName="fixed inset-0 z-50 grid place-items-center bg-[var(--ink)]/80 backdrop-blur-sm p-6">
      <div className="card-surgical max-w-sm p-6">
        <h2 id="consent-title" className="mb-3 text-lg font-bold text-[var(--paper)]">All work, no ads!</h2>
        <p className="mb-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          J-Pay records your GPS location and time at your check-ins so your employer can run
          payroll accurately. While your shift clock is running it also records coarse fixes
          so your manager can see travel between sites — never off shift, never during lunch
          or side missions. A one-time disclaimer explains this the first time you open the app.
          Raw coordinates are zeroed after the dispute window. Your data is never sold or used
          for advertising.
        </p>
        <p className="mb-4 text-xs leading-relaxed text-[var(--fog)]">
          See full details in our{" "}
          <a href="/privacy" className="text-[var(--mint)] underline hover:brightness-110">Privacy Policy</a>.
        </p>
        <button
          data-testid="consent-acknowledge"
          onClick={onAccept}
          className="btn-surgical btn-surgical-mint w-full min-h-[44px] rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          I understand
        </button>
      </div>
    </FocusTrapModal>
  );
}

function InstallRequestModal({
  isIos,
  canInstall,
  onInstall,
  onDone,
}: {
  isIos: boolean;
  canInstall: boolean;
  onInstall: () => void;
  onDone: () => void;
}) {
  return (
    <FocusTrapModal labelledBy="install-title" overlayClassName="fixed inset-0 z-[90] grid place-items-center bg-[var(--ink)]/85 backdrop-blur-sm p-6">
      <div className="card-surgical w-full max-w-sm p-6 border-[var(--mint)]/40">
        <h2 id="install-title" tabIndex={-1} className="mb-2 text-lg font-bold tracking-tight text-[var(--paper)] outline-none">Install J-Pay</h2>
        {isIos ? (
          <p className="mb-4 text-sm leading-relaxed text-[var(--text-secondary)]">
            Add J-Pay to your Home Screen: tap the Share button in Safari, then
            “Add to Home Screen”. You get one-tap check-ins and offline support.
          </p>
        ) : canInstall ? (
          <p className="mb-4 text-sm leading-relaxed text-[var(--text-secondary)]">
            Install J-Pay for one-tap check-ins, offline support and shift alerts.
            No app store required.
          </p>
        ) : (
          <p className="mb-4 text-sm leading-relaxed text-[var(--text-secondary)]">
            Add J-Pay to your Home Screen from your browser menu (“Install app” /
            “Add to Home Screen”) for one-tap check-ins and offline support.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {canInstall && !isIos && (
            <button onClick={onInstall} className="btn-surgical btn-surgical-mint min-h-[44px] rounded-lg px-4 py-2.5 text-sm font-semibold">
              Install
            </button>
          )}
          <button onClick={onDone} autoFocus={!canInstall || isIos} className="btn-surgical min-h-[44px] rounded-lg px-4 py-2.5 text-sm text-[var(--text-secondary)]">
            Not now
          </button>
        </div>
      </div>
    </FocusTrapModal>
  );
}

function TravelDisclaimerModal({
  busy,
  error,
  onAck,
  onDefer,
}: {
  busy: boolean;
  error: string | null;
  onAck: () => void;
  onDefer: () => void;
}) {
  return (
    <FocusTrapModal labelledBy="travel-disclaimer-title" overlayClassName="fixed inset-0 z-[85] grid place-items-center bg-[var(--ink)]/85 backdrop-blur-sm p-6">
      <div className="card-surgical w-full max-w-sm p-6 border-[var(--mint)]/40">
        <h2 id="travel-disclaimer-title" tabIndex={-1} className="mb-2 text-lg font-bold tracking-tight text-[var(--paper)] outline-none">Location while you travel</h2>
        <p className="mb-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          While your shift clock is running, J-Pay records coarse GPS positions so your
          manager can see you travelling between sites. It is automatic — you don&apos;t
          need to do anything.
        </p>
        <ul className="mb-4 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--text-secondary)]">
          <li>Only while your shift clock is running. Shift ended → no tracking.</li>
          <li>Not during lunch, side missions or sick leave.</li>
          <li>Only until you arrive at a site — inside a geofence nothing is recorded.</li>
          <li>Raw route data is deleted after 90 days; distance and duration are kept for payroll evidence.</li>
        </ul>
        {error && <p role="alert" className="mb-2 text-sm text-[var(--danger)]">{error}</p>}
        <button onClick={onAck} disabled={busy} autoFocus className="btn-surgical btn-surgical-mint min-h-[44px] w-full rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60">
          {busy ? "Saving…" : "Got it — I understand"}
        </button>
        <button onClick={onDefer} className="mt-2 min-h-[44px] w-full rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] underline">
          Not now — don&apos;t track me (re-asked in 7 days; travel stays off)
        </button>
      </div>
    </FocusTrapModal>
  );
}

function ManagerCard() {
  return (
    <section className="card-surgical p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">
        Manager
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
        Your crew is waiting — live positions, travel status and on-site arrival for the sites you manage.
      </p>
      <a
        href="/manager"
        className="btn-surgical btn-surgical-mint mt-4 flex min-h-[44px] items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold"
      >
        Open manager console →
      </a>
    </section>
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
