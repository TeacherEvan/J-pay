"use client";

import { useAction } from "@/lib/backend/react";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { api } from "@/lib/backend/api";
import { errMsg } from "@/lib/errors";

type PasswordFormProps = {
  onSaved?: () => void;
  compact?: boolean;
  submitRef?: RefObject<HTMLButtonElement | null>;
};

export function PasswordFields({ onSaved, compact, submitRef }: PasswordFormProps) {
  const change = useAction(api.users.changeMyPassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const localRef = useRef<HTMLButtonElement | null>(null);
  const buttonRef = submitRef ?? localRef;

  async function submit() {
    if (next !== confirm) {
      setMsg("New passwords do not match.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await change({ currentSecret: current, newSecret: next });
      setMsg("Password updated. Use it from now on.");
      setCurrent("");
      setNext("");
      setConfirm("");
      onSaved?.();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = compact
    ? "input-surgical px-3 py-2 text-sm"
    : "input-surgical px-3.5 py-2.5 text-sm w-full";
  const idSuffix = compact ? "compact" : "forced";

  return (
    <div className="flex flex-col gap-2.5">
      <label className="sr-only" htmlFor={`${idSuffix}-pw-current`}>Current password / ID code</label>
      <input id={`${idSuffix}-pw-current`} value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password / ID code" type="password" className={inputCls} />
      <label className="sr-only" htmlFor={`${idSuffix}-pw-next`}>New password (min 8 chars)</label>
      <input id={`${idSuffix}-pw-next`} value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8 chars)" type="password" className={inputCls} />
      <label className="sr-only" htmlFor={`${idSuffix}-pw-confirm`}>Confirm new password</label>
      <input id={`${idSuffix}-pw-confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" type="password" className={inputCls} />
      <button ref={buttonRef} data-loading={busy} aria-busy={busy} onClick={() => void submit()} disabled={busy || !current || next.length < 8}
        className={compact ? "btn-surgical min-h-[44px] self-start px-4 py-2 text-sm disabled:opacity-50" : "btn-surgical btn-surgical-mint min-h-[44px] w-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50"}>
        <span className="btn-label">Update password</span>
        <span className="btn-spinner" aria-hidden="true" />
      </button>
      {msg && <p role="status" aria-live="polite" className={compact ? "text-sm text-[var(--fog)]" : "text-center text-sm font-medium text-[var(--paper)]"}>{msg}</p>}
    </div>
  );
}

export function ChangePassword() {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-[var(--fog)] hover:text-[var(--paper)] transition">
        Change password (replace your one-time ID code)
      </summary>
      <div className="card-subpanel mt-2 p-3">
        <PasswordFields compact />
      </div>
    </details>
  );
}

export function ForcedPasswordChange() {
  const [saved, setSaved] = useState(false);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!saved) submitRef.current?.focus();
  }, [saved]);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => window.location.reload(), 1200);
    return () => clearTimeout(t);
  }, [saved]);
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-[var(--ink)]/90 backdrop-blur-sm p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forced-pw-title"
    >
      <div className="card-surgical w-full max-w-sm p-6 border-[var(--mint)]/40 shadow-[0_0_24px_var(--mint-glow)]">
        {!saved ? (
          <>
            <h2 id="forced-pw-title" className="mb-2 text-lg font-bold text-[var(--paper)]">Set your own password</h2>
            <p className="mb-4 text-sm text-[var(--text-secondary)]">
              You are signed in with a one-time code from your moderator. Choose a personal
              password to continue — you will only be asked once.
            </p>
            <PasswordFields submitRef={submitRef} onSaved={() => setSaved(true)} />
          </>
        ) : (
          <>
            <h2 id="forced-pw-title" className="mb-2 text-lg font-bold text-[var(--mint)]">Password saved ✓</h2>
            <p role="status" aria-live="polite" className="mb-4 text-sm text-[var(--fog)]">Reloading…</p>
          </>
        )}
      </div>
    </div>
  );
}
