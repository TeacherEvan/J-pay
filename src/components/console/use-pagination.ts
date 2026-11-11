"use client";

import { useEffect, useMemo, useState } from "react";

/** Fixed-size client-side pagination — the zero-scroll substitute for overflow. */
const EMPTY: readonly never[] = Object.freeze([]) as readonly never[];

export function usePagination<T>(items: T[], pageSize: number) {
  // Stabilise empty arrays: callers pass `x ?? []`, a fresh reference every
  // render — which defeated the pageItems memo below (audit 2026-11-11, D23).
  const stable = items.length === 0 ? (EMPTY as unknown as T[]) : items;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(stable.length / pageSize));
  const clamped = Math.min(page, pageCount - 1);

  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const pageItems = useMemo(
    () => stable.slice(clamped * pageSize, clamped * pageSize + pageSize),
    [stable, clamped, pageSize],
  );

  const setPageClamped = (p: number | ((prev: number) => number)) =>
    setPage((prev) => {
      const target = typeof p === "function" ? p(prev) : p;
      return Math.max(0, Math.min(target, pageCount - 1));
    });

  return { page: clamped, pageCount, pageItems, setPage: setPageClamped, total: stable.length };
}
