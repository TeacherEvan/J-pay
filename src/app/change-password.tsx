"use client";

import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { errMsg } from "@/lib/errors";

type PasswordFormProps = {
  onSaved?: () => void;
  compact?: boolean;
};

export function PasswordFields({ onSaved, compact }: PasswordFormProps) {
  const change = useAction(api.users.changeMyPassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    ? "rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs"
    : "rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm w-full";

  return (
    <div className="flex flex-col gap-2">
      <input value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password / ID code" type="password" className={inputCls} />
      <input value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8 chars)" type="password" className={inputCls} />
      <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" type="password" className={inputCls} />
      <button onClick={() => void submit()} disabled={busy || !current || next.length < 8}
        className={compact ? "self-start rounded border border-neutral-700 px-2 py-1 disabled:opacity-50" : "rounded-md bg-emerald-500 px-3 py-2 font-semibold text-emerald-950 disabled:opacity-50"}>
        {busy ? "Saving…" : "Update password"}
      </button>
      {msg && <p className={compact ? "text-neutral-300" : "text-center text-sm"}>{msg}</p>}
    </div>
  );
}

export function ChangePassword() {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">
        Change password (replace your one-time ID code)
      </summary>
      <div className="mt-2">
        <PasswordFields compact />
      </div>
    </details>
  );
}

export function ForcedPasswordChange() {
  const [saved, setSaved] = useState(false);
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/90 p-6">
      <div className="w-full max-w-sm rounded-xl border border-emerald-800 bg-neutral-950 p-6">
        {!saved ? (
          <>
            <h2 className="mb-2 text-lg font-semibold">Set your own password</h2>
            <p className="mb-4 text-sm text-neutral-400">
              You are signed in with a one-time code from your moderator. Choose a personal
              password to continue — you will only be asked once.
            </p>
            <PasswordFields onSaved={() => setSaved(true)} />
          </>
        ) : (
          <>
            <h2 className="mb-2 text-lg font-semibold">Password saved ✓</h2>
            <p className="mb-4 text-sm text-neutral-400">Reloading…</p>
            {typeof window !== "undefined" && setTimeout(() => window.location.reload(), 1200)}
          </>
        )}
      </div>
    </div>
  );
}
