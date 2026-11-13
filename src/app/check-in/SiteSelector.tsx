import { useRef } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CardSite, Phase } from "./types";

function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

interface SiteSelectorProps {
  sites: CardSite[];
  sitesLoading: boolean;
  siteId: Id<"sites"> | "";
  phase: Phase;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onSelectSite: (id: Id<"sites">) => void;
  distances: Map<string, number | null>;
  siteNameOf: (id?: Id<"sites">) => string | undefined;
  lastSiteId?: Id<"sites">;
}

export function SiteSelector({
  sites,
  sitesLoading,
  siteId,
  phase,
  pickerOpen,
  setPickerOpen,
  onSelectSite,
  distances,
  siteNameOf,
  lastSiteId,
}: SiteSelectorProps) {
  const siteRefs = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <>
      {sites.length > 0 && (phase === "off" || pickerOpen) && (
        <div
          role="radiogroup"
          aria-label="Site"
          className="card-subpanel flex flex-col gap-1.5 p-2"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const cur = sites.findIndex((s) => s._id === siteId);
            const next =
              e.key === "ArrowDown"
                ? (cur + 1) % sites.length
                : (cur - 1 + sites.length) % sites.length;
            onSelectSite(sites[next]!._id);
            siteRefs.current[next]?.focus();
          }}
        >
          {sites.map((s, i) => {
            const selected = siteId ? siteId === s._id : i === 0;
            const dist = distances.get(s._id) ?? null;
            return (
              <button
                key={s._id}
                ref={(el) => {
                  siteRefs.current[i] = el;
                }}
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  onSelectSite(s._id);
                }}
                className={`btn-surgical flex min-h-[44px] items-center justify-between rounded-xl px-4 py-2.5 text-left text-sm ${
                  selected
                    ? "border-[var(--mint)]/70 bg-[var(--mint)]/10 text-[var(--paper)] shadow-[inset_0_1px_0_0_oklch(1_0_0/0.18)]"
                    : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--fog)]"
                }`}
              >
                <span className="font-medium">{s.name}</span>
                {dist !== null && (
                  <span className="tnum text-xs text-[var(--fog)]">{formatDistance(dist)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {sites.length > 0 && phase !== "off" && (
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="self-start text-xs text-[var(--fog)] underline hover:text-[var(--paper)] touch-target-44 flex items-center"
        >
          {pickerOpen ? "Hide sites" : `Site: ${siteNameOf(siteId || lastSiteId) ?? "choose"}`}
        </button>
      )}
      {sites.length === 0 && !sitesLoading && (
        <p className="rounded-xl border border-[var(--hivis)]/30 bg-[var(--hivis)]/10 p-3.5 text-sm text-[var(--hivis)]">
          No site assigned yet — your moderator must assign you before you can check in.
        </p>
      )}
    </>
  );
}
