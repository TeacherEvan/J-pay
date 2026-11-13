import type { Status } from "./types";
import { LABEL } from "./types";
import { StatusIcon } from "./StatusIcon";

interface StatusChipsProps {
  chips: Status[];
  pending: Status;
  setPending: (s: Status) => void;
}

export function StatusChips({ chips, pending, setPending }: StatusChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-2"
      role="radiogroup"
      aria-label="What's happening"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          const idx = chips.indexOf(pending);
          const next = chips[(idx + 1) % chips.length];
          setPending(next);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const idx = chips.indexOf(pending);
          const prev = chips[(idx - 1 + chips.length) % chips.length];
          setPending(prev);
        }
      }}
    >
      {chips.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={pending === s}
          tabIndex={pending === s ? 0 : -1}
          onClick={() => setPending(s)}
          className={`pill-surgical min-h-[44px] ${
            pending === s
              ? "border-[var(--hivis)]/70 bg-[var(--hivis)]/15 text-[var(--hivis)] shadow-[0_0_10px_var(--hivis-glow)]"
              : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--fog)]"
          }`}
        >
          <StatusIcon status={s} />
          {LABEL[s]}
        </button>
      ))}
    </div>
  );
}
