"use client";

import { useEffect, useMemo, useState } from "react";

/** Fixed-size client-side pagination — the zero-scroll substitute for overflow. */
export function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(page, pageCount - 1);

  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const pageItems = useMemo(
    () => items.slice(clamped * pageSize, clamped * pageSize + pageSize),
    [items, clamped, pageSize],
  );

  return { page: clamped, pageCount, pageItems, setPage, total: items.length };
}
