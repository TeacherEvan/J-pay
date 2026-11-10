"use client";

import { useState } from "react";
import { useMutation } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errMsg } from "@/lib/errors";

/* ─────────────────────── Small action cells ─────────────────────── */

export function DeactivateButton({ userId }: { userId: string }) {
  const deactivate = useMutation(api.users.deactivateEmployee);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return confirming ? (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() =>
          void deactivate({ userId: userId as Id<"users"> })
            .then(() => setConfirming(false))
            .catch((e) => setError(errMsg(e)))
        }
        className="btn-surgical rounded border-[var(--danger)]/40 px-2 py-1 text-xs text-[var(--danger)]"
      >
        confirm
      </button>
      <button onClick={() => { setConfirming(false); setError(null); }} className="btn-surgical rounded px-2 py-1 text-xs text-[var(--fog)]">
        cancel
      </button>
      {error && <span role="alert" className="max-w-[10rem] truncate text-xs text-[var(--danger)]">{error}</span>}
    </span>
  ) : (
    <button onClick={() => setConfirming(true)} className="btn-surgical rounded px-2 py-1 text-xs text-[var(--fog)] hover:text-[var(--danger)]">
      deactivate
    </button>
  );
}

export function LocaleCell({ userId, initial }: { userId: Id<"users">; initial: string }) {
  const setUserLocale = useMutation(api.users.setUserLocale);
  const [localeError, setLocaleError] = useState<string | null>(null);
  const LOCALES = ["en-ZA", "en-US", "en-GB", "en-AU", "es-ES", "fr-FR"] as const;
  return (
    <select
      defaultValue={initial}
      onChange={(e) =>
        void setUserLocale({ userId, locale: e.target.value as (typeof LOCALES)[number] }).catch(
          (err) => setLocaleError(errMsg(err))
        )
      }
      aria-label={localeError ? `Set locale (current saved — ${localeError})` : "Set locale"}
      title={localeError ?? undefined}
      className="input-surgical px-2 py-1.5 text-xs"
    >
      {LOCALES.map((l: any) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function RateCell({ userId, initial }: { userId: Id<"users">; initial?: number }) {
  const setRate = useMutation(api.moderator.setHourlyOverride);
  const [value, setValue] = useState(initial === undefined ? "" : String(initial));
  const [saved, setSaved] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const inputId = `rate-${userId}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      <label htmlFor={inputId} className="sr-only">
        Hourly rate
      </label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        inputMode="decimal"
        min={0}
        placeholder="default"
        className="input-surgical tnum w-16 px-2 py-1 text-right text-xs"
      />
      <button
        onClick={async () => {
          const n = value.trim() === "" ? undefined : Number(value);
          if (value.trim() !== "" && Number.isNaN(n)) return;
          try {
            await setRate({ userId, rate: n });
            setSaved(true);
            setRateError(null);
          } catch (e) {
            setRateError(errMsg(e));
          }
        }}
        aria-label={saved ? `Rate saved for ${userId}` : `Set hourly rate for ${userId}`}
        className="btn-surgical rounded px-2 py-1 text-xs font-medium"
      >
        {saved ? "✓" : "set"}
      </button>
      {rateError && <span role="alert" className="max-w-[10rem] truncate text-xs text-[var(--danger)]">{rateError}</span>}
    </span>
  );
}

export function ResetDeviceButton({ userId }: { userId: Id<"users"> }) {
  const reset = useMutation(api.users.resetDeviceToken);
  const [confirming, setConfirming] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  return confirming ? (
    <span className="inline-flex gap-1">
      <button
        onClick={() =>
          void reset({ userId })
            .then(() => setConfirming(false))
            .catch((e) => setResetError(errMsg(e)))
        }
        className="btn-surgical rounded border-[var(--hivis)]/40 px-2 py-1 text-xs text-[var(--hivis)]"
      >
        confirm
      </button>
      <button onClick={() => { setConfirming(false); setResetError(null); }} className="btn-surgical rounded px-2 py-1 text-xs text-[var(--fog)]">
        cancel
      </button>
      {resetError && <span role="alert" className="max-w-[10rem] truncate text-xs text-[var(--danger)]">{resetError}</span>}
    </span>
  ) : (
    <button onClick={() => setConfirming(true)} className="btn-surgical rounded px-2 py-1 text-xs text-[var(--fog)] hover:text-[var(--hivis)]">
      reset device
    </button>
  );
}
