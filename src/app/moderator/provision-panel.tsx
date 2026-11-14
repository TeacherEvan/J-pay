"use client";

import { useEffect, useState } from "react";
import { useAction } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { ConsoleWindow } from "@/components/console/window";
import { errMsg } from "@/lib/errors";
import { useOrg } from "./org-context";

/* ─────────────────────────── Provision panel ─────────────────────────── */

const LOCALE_OPTIONS = ["en-ZA", "en-US", "en-GB", "en-AU", "es-ES", "fr-FR"] as const;
type LocaleOption = (typeof LOCALE_OPTIONS)[number];
type ProvisionRole = "employee" | "manager" | "moderator";

type ProvisionEmployeeArgs = {
  name: string;
  email: string;
  orgId: string;
  role?: "employee" | "manager";
  siteIds?: string[];
  hourlyRateOverride?: number;
  locale?: LocaleOption;
};

type ProvisionResult = {
  userId?: string;
  email: string;
  idCode: string;
};

export function ProvisionPanel({ sites = [] }: { sites?: { _id: string; name: string }[] }) {
  const provisionEmployeeAction = useAction<ProvisionEmployeeArgs, ProvisionResult>(api.users.provisionEmployee);
  const provisionModeratorAction = useAction<{ name: string; email: string }, ProvisionResult>(
    api.users.provisionModerator,
  );
  const { orgId } = useOrg();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProvisionRole>("employee");
  const [selectedSites, setSelectedSites] = useState<string[]>([]);
  const [rateText, setRateText] = useState("");
  const [locale, setLocale] = useState<"" | LocaleOption>("");
  const [code, setCode] = useState<{ email: string; idCode: string; role: ProvisionRole } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelectedSites([]);
    setError(null);
  }, [orgId]);

  const toggleSite = (siteId: string) => {
    setSelectedSites((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId],
    );
  };

  async function handleSubmit() {
    if (busy) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail || (role !== "moderator" && !orgId)) return;

    let hourlyRateOverride: number | undefined;
    if (role !== "moderator" && rateText.trim() !== "") {
      const parsed = Number(rateText.trim());
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) {
        setError("Hourly rate must be a number between 0 and 100,000.");
        return;
      }
      hourlyRateOverride = parsed;
    }

    const validSiteIds = selectedSites.filter((id) => sites.some((s) => s._id === id));

    setBusy(true);
    setError(null);
    setCode(null);
    setCopied(false);
    try {
      const result =
        role === "moderator"
          ? await provisionModeratorAction({ name: trimmedName, email: trimmedEmail })
          : await provisionEmployeeAction({
              name: trimmedName,
              email: trimmedEmail,
              orgId: orgId as never,
              role,
              siteIds: validSiteIds.length > 0 ? (validSiteIds as never) : undefined,
              hourlyRateOverride,
              locale: locale || undefined,
            });
      setCode({ email: result.email, idCode: result.idCode, role });
      setName("");
      setEmail("");
      setSelectedSites([]);
      setRateText("");
      setLocale("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConsoleWindow
      title="Provision account"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-2 overflow-y-auto p-3"
      aside={
        <span className="text-xs text-[var(--fog)]">
          {role === "moderator"
            ? "platform-wide (not scoped to an org)"
            : orgId
              ? "lands in selected org"
              : "select an org first"}
        </span>
      }
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label htmlFor="provision-name" className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Full name</span>
            <input
              id="provision-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="input-surgical px-3.5 py-1.5 text-sm"
            />
          </label>
          <label htmlFor="provision-email" className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Email</span>
            <input
              id="provision-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              className="input-surgical px-3.5 py-1.5 text-sm"
            />
          </label>
        </div>

        <label htmlFor="provision-role" className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Role</span>
          <select
            id="provision-role"
            value={role}
            onChange={(e) => setRole(e.target.value as ProvisionRole)}
            className="input-surgical px-3.5 py-1.5 text-sm"
          >
            <option value="employee">Role: Employee (selected org)</option>
            <option value="manager">Role: Manager (selected org)</option>
            <option value="moderator">Role: Platform Moderator (all orgs — global)</option>
          </select>
        </label>

        {(role === "employee" || role === "manager") && (
          <>
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">
                  Initial sites <span className="font-normal normal-case tracking-normal">(optional)</span>
                </span>
                {selectedSites.length > 0 && (
                  <span className="text-xs font-medium text-[var(--mint)]">{selectedSites.length} selected</span>
                )}
              </div>
              {sites.length === 0 ? (
                <p className="text-xs text-[var(--fog)]">No sites in this org yet — assign sites later.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Initial sites">
                  {sites.map((s) => {
                    const on = selectedSites.includes(s._id);
                    return (
                      <button
                        key={s._id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleSite(s._id)}
                        className={`btn-surgical min-h-[36px] rounded-full px-3 py-1 text-xs font-semibold ${
                          on
                            ? "border-[var(--mint)]/70 bg-[var(--mint)]/15 text-[var(--mint)]"
                            : "text-[var(--fog)] hover:text-[var(--paper)]"
                        }`}
                      >
                        {on ? "✓ " : ""}
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {role === "manager" && (
                <p className="text-xs text-[var(--cyan)]">
                  Selected sites become both their check-in sites and supervised sites.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label htmlFor="provision-rate" className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">
                  Hourly rate
                </span>
                <input
                  id="provision-rate"
                  type="number"
                  min="0"
                  max="100000"
                  step="0.01"
                  inputMode="decimal"
                  value={rateText}
                  onChange={(e) => setRateText(e.target.value)}
                  placeholder="Org default"
                  className="input-surgical px-3 py-1.5 text-sm"
                />
              </label>
              <label htmlFor="provision-locale" className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">
                  Jurisdiction / Locale
                </span>
                <select
                  id="provision-locale"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as "" | LocaleOption)}
                  className="input-surgical px-3 py-1.5 text-sm"
                >
                  <option value="">Default</option>
                  {LOCALE_OPTIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}

        <button
          type="submit"
          data-loading={busy}
          aria-busy={busy}
          disabled={busy || !name.trim() || !email.trim() || (role !== "moderator" && !orgId)}
          className="btn-surgical btn-surgical-mint min-h-[44px] flex-none px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          <span className="btn-label">Create account + ID code ({role})</span>
          <span className="btn-spinner" aria-hidden="true" />
        </button>
      </form>

      {error && (
        <p role="alert" className="flex-none text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      {code && (
        <div className="card-subpanel flex-none border-[var(--mint)]/60 bg-[var(--mint)]/10 p-2.5 text-xs text-[var(--paper)]">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--mint)]">
              Shown once — hand over NOW ({code.role}):
            </p>
            <button
              type="button"
              onClick={() => setCode(null)}
              aria-label="Dismiss ID code"
              className="rounded px-2 py-0.5 text-xs text-[var(--fog)] hover:text-[var(--paper)]"
            >
              dismiss
            </button>
          </div>
          <p className="truncate">
            Email: <strong>{code.email}</strong>
          </p>
          <p>
            ID code: <strong className="tnum font-mono tracking-widest text-[var(--mint)]">{code.idCode}</strong>
          </p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(`${code.email}: ${code.idCode}`)
                .then(() => setCopied(true))
                .catch(() => {});
            }}
            className="btn-surgical mt-1.5 px-3 py-1 text-xs font-semibold border-[var(--mint)]/40 text-[var(--mint)] hover:bg-[var(--mint)]/10"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      )}
    </ConsoleWindow>
  );
}
