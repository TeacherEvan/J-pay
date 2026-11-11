"use client";

import { errMsg } from "@/lib/errors";

/**
 * Shared honest query-failure surface (audit 2026-11-11, D2).
 * Rendered wherever `useQueryResult` reports `error` instead of a skeleton
 * that never resolves.
 */
export function QueryError({ error, onRetry, label }: { error: unknown; onRetry?: () => void; label?: string }) {
  return (
    <div role="alert" className="flex flex-none items-center gap-2 rounded-lg border border-[var(--hivis)]/40 bg-[var(--hivis)]/10 px-3 py-2 text-xs font-medium text-[var(--hivis)]">
      <span className="min-w-0 flex-1">
        {label ? `${label}: ` : ""}
        {errMsg(error)}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn-surgical flex-none px-2.5 py-1 text-[11px] font-semibold"
        >
          Retry
        </button>
      )}
    </div>
  );
}
