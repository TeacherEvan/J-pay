"use client";

import { useRef } from "react";

export type ConsoleTab = { id: string; label: string; badge?: number };

/**
 * Console view switcher. ≥md: pill tab bar (role=tablist with roving
 * tabindex + arrow-key navigation per WAI-ARIA tabs pattern). <md: native
 * select (role=tablist is meaningless at 390px for 7 tabs; one 44px row,
 * zero scroll).
 */
export function ConsoleTabs({
  tabs,
  active,
  onChange,
  ariaLabel,
}: {
  tabs: ConsoleTab[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === active);
    if (index === -1) return;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    onChange(target.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      {/* Mobile: dropdown window switcher */}
      <div className="border-b border-[var(--line)] bg-[var(--panel-2)] px-2 py-1.5 md:hidden">
        <label className="sr-only" htmlFor="console-tab-select">{ariaLabel}</label>
        <div className="relative">
          <select
            id="console-tab-select"
            data-testid="console-tab-select"
            value={active}
            onChange={(e) => onChange(e.target.value)}
            className="input-surgical h-11 w-full appearance-none px-3.5 pr-9 text-sm font-semibold"
          >
            {tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}{t.badge ? ` (${t.badge})` : ""}
              </option>
            ))}
          </select>
          <svg aria-hidden="true" viewBox="0 0 12 8" className="pointer-events-none absolute right-3.5 top-1/2 h-2.5 w-3 -translate-y-1/2 text-[var(--fog)]" fill="none">
            <path d="M1 1.5 6 6.5 11 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      {/* Desktop: pill tab bar */}
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="hidden items-center gap-1.5 overflow-hidden border-b border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 md:flex"
      >
        {tabs.map((t, i) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`tabpanel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              data-testid={`console-tab-${t.id}`}
              onClick={() => onChange(t.id)}
              className={`console-pill ${selected ? "console-pill-active" : ""}`}
            >
              {t.label}
              {t.badge ? (
                <span className="tnum ml-1.5 rounded-full bg-[var(--danger)]/25 px-1.5 py-0.5 text-xs font-bold text-[var(--danger)]">
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}
