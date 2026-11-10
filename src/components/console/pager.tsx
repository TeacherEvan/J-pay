"use client";

/** Compact pager used by every zero-scroll window. 44px touch targets. */
export function Pager({
  page,
  pageCount,
  total,
  onPage,
  label,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
  label: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--line-subtle)] pt-2">
      <span className="tnum text-xs text-[var(--fog)]">
        {label} · page {page + 1}/{pageCount} · {total} row{total === 1 ? "" : "s"}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className="btn-surgical min-h-[44px] min-w-[44px] px-2 text-sm disabled:opacity-35"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
          className="btn-surgical min-h-[44px] min-w-[44px] px-2 text-sm disabled:opacity-35"
        >
          ›
        </button>
      </span>
    </div>
  );
}
