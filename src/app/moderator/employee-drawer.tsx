"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { FocusTrapModal } from "@/components/console/focus-trap-modal";
import { errMsg } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useUserLocale } from "@/lib/use-user-locale";
import type { CrewShiftRow } from "@/components/console/live-crew-map";
import { DeactivateButton, LocaleCell, RateCell, ResetDeviceButton } from "./action-cells";
import { useOrg } from "./org-context";
import type { ModeratorEmployee } from "./types";

const pad2 = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

function sameSiteSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const id of b) if (!setA.has(id)) return false;
  return true;
}

function toggleSiteId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function SiteToggleGroup({
  sites,
  selectedIds,
  onToggle,
  ariaLabel,
  accent,
  disabled,
}: {
  sites: { _id: string; name: string }[];
  selectedIds: string[];
  onToggle: (siteId: string) => void;
  ariaLabel: string;
  accent: "mint" | "cyan";
  disabled: boolean;
}) {
  if (sites.length === 0) {
    return <p className="text-xs text-[var(--fog)]">No sites in this org yet.</p>;
  }
  const activeClass =
    accent === "mint"
      ? "border-[var(--mint)]/70 bg-[var(--mint)]/15 text-[var(--mint)]"
      : "border-[var(--cyan)]/70 bg-[var(--cyan)]/15 text-[var(--cyan)]";
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {sites.map((s) => {
        const on = selectedIds.includes(s._id);
        return (
          <button
            key={s._id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(s._id)}
            className={`btn-surgical min-h-[36px] rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
              on ? activeClass : "text-[var(--fog)] hover:text-[var(--paper)]"
            }`}
          >
            {on ? "✓ " : ""}
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

type ManagerRow = {
  _id: string;
  name?: string | null;
  email?: string | null;
  isActive: boolean;
  managedSiteIds: string[];
  managedSiteNames: string[];
};

/**
 * The one place to act on a specific person. Opened from the Live roster, a map
 * pin, the Crew table — anywhere a user appears — via `useOrg().openUser(id)`.
 */
export function EmployeeDrawer({
  employees,
  sites,
}: {
  employees: ModeratorEmployee[];
  sites: { _id: string; name: string }[];
}) {
  const { orgId, focusUserId, closeUser, goto } = useOrg();
  const locale = useUserLocale();
  const person = employees.find((e) => e._id === focusUserId);
  const isManager = person?.role === "manager";
  const deactivated = person?.archivedAt !== undefined;

  const active = useQuery(api.moderator.activeShifts, orgId ? { orgId } : "skip") as CrewShiftRow[] | undefined;
  const managers = useQuery(
    api.manager.listManagers,
    orgId && focusUserId && isManager && !deactivated ? { orgId } : "skip",
  ) as ManagerRow[] | undefined;

  const reply = useMutation(api.messages.replyToEmployee);
  const endShift = useMutation(api.moderator.endShiftOverride);
  const promote = useMutation(api.manager.promoteToManager);
  const demote = useMutation(api.manager.demoteManager);
  const setEmployeeSites = useMutation(api.sites.setEmployeeSites);
  const setManagerSites = useMutation(api.manager.setManagerSites);

  const serverAssigned = person?.assignedSiteIds ?? [];
  const serverAssignedKey = [...serverAssigned].sort().join(",");
  const managerRow = isManager ? managers?.find((m) => m._id === person?._id) : undefined;
  const serverManaged = !isManager
    ? undefined
    : managers === undefined
      ? undefined
      : (managerRow?.managedSiteIds ?? []);
  const serverManagedKey = serverManaged ? [...serverManaged].sort().join(",") : null;

  const [text, setText] = useState("");
  const [endWhen, setEndWhen] = useState("");
  const [endReason, setEndReason] = useState("");
  const [endOpen, setEndOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [siteNote, setSiteNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [draftAssigned, setDraftAssigned] = useState<string[]>(serverAssigned);
  const [draftManaged, setDraftManaged] = useState<string[]>(serverManaged ?? []);

  useEffect(() => {
    setText("");
    setEndWhen("");
    setEndReason("");
    setEndOpen(false);
    setNote(null);
    setSiteNote(null);
  }, [focusUserId, orgId]);

  useEffect(() => {
    setDraftAssigned(person?.assignedSiteIds ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person?._id, orgId, serverAssignedKey]);

  useEffect(() => {
    setDraftManaged(serverManaged ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person?._id, orgId, serverManagedKey]);

  if (!focusUserId) return null;

  const shift = active?.find((r) => r.userId === focusUserId);
  const siteNames = sites.filter((s) => person?.assignedSiteIds?.includes(s._id)).map((s) => s.name);
  const assignedDirty = Boolean(person && !sameSiteSet(draftAssigned, serverAssigned));
  const managedDirty = Boolean(serverManaged !== undefined && !sameSiteSet(draftManaged, serverManaged));

  async function run(key: string, okText: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      setNote({ tone: "ok", text: okText });
      after?.();
    } catch (e) {
      setNote({ tone: "err", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  async function saveSites(
    key: "assignedSites" | "managedSites",
    okText: string,
    fn: () => Promise<unknown>,
  ) {
    setBusy(key);
    setSiteNote(null);
    try {
      await fn();
      setSiteNote({ tone: "ok", text: okText });
    } catch (e) {
      setSiteNote({ tone: "err", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <FocusTrapModal
      labelledBy="employee-drawer-title"
      onClose={closeUser}
      overlayClassName="fixed inset-0 z-[80] flex justify-end bg-[var(--ink)]/60 backdrop-blur-[2px]"
      className="h-full w-full max-w-md overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] shadow-2xl"
    >
      <div className="flex flex-col gap-3 p-4" data-testid="employee-drawer">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id="employee-drawer-title" className="truncate text-lg font-bold text-[var(--paper)]">
              {person?.name ?? person?.email ?? "Employee"}
            </h2>
            <p className="truncate text-xs text-[var(--fog)]">{person?.email}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs font-semibold">
              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 uppercase tracking-wider text-[var(--text-secondary)]">
                {person?.role ?? "employee"}
              </span>
              <span className={`rounded-full border px-2 py-0.5 ${deactivated ? "border-[var(--danger)]/40 text-[var(--danger)]" : "border-[var(--mint)]/40 text-[var(--mint)]"}`}>
                {deactivated ? "deactivated" : "active"}
              </span>
              {shift && (
                <span className="rounded-full border border-[var(--cyan)]/40 px-2 py-0.5 text-[var(--cyan)]">
                  on shift since {formatDateTime(shift.startedAt, locale)}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={closeUser}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-lg text-[var(--fog)] hover:text-[var(--paper)]"
          >
            ✕
          </button>
        </header>

        {(deactivated || !orgId || shift?.lastLog) && (
          <section className="text-xs text-[var(--text-secondary)]">
            {(deactivated || !orgId) && (
              <p>
                <span className="text-[var(--fog)]">Sites: </span>
                {siteNames.join(", ") || "none assigned"}
              </p>
            )}
            {shift?.lastLog && (
              <p className={deactivated || !orgId ? "mt-0.5" : undefined}>
                <span className="text-[var(--fog)]">Last ping: </span>
                {formatDateTime(shift.lastLog.clientReportedTime, locale)} · {shift.lastLog.status} ·{" "}
                {shift.lastLog.isWithinGeofence ? "inside geofence" : "outside geofence"}
              </p>
            )}
          </section>
        )}

        <section className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-surgical min-h-[44px] flex-1 px-3 py-2 text-xs font-semibold text-[var(--mint)]"
            onClick={() => goto("payroll", { userId: focusUserId })}
          >
            Payroll →
          </button>
          <button
            type="button"
            className="btn-surgical min-h-[44px] flex-1 px-3 py-2 text-xs font-semibold text-[var(--cyan)]"
            onClick={() => goto("audit", { userId: focusUserId, auditSegment: "activity" })}
          >
            Audit →
          </button>
        </section>

        {person && !deactivated && orgId && (
          <section className="flex flex-col gap-2.5 rounded-lg border border-[var(--line)] p-2.5">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">
                  Assigned sites
                </span>
                <span className="text-xs text-[var(--fog)]">
                  {draftAssigned.length} selected
                </span>
              </div>
              <SiteToggleGroup
                sites={sites}
                selectedIds={draftAssigned}
                ariaLabel="Assigned sites"
                accent="mint"
                disabled={busy === "assignedSites"}
                onToggle={(siteId) => {
                  setSiteNote(null);
                  setDraftAssigned((prev) => toggleSiteId(prev, siteId));
                }}
              />
              {(assignedDirty || busy === "assignedSites") && (
                <button
                  type="button"
                  disabled={busy === "assignedSites"}
                  onClick={() =>
                    saveSites(
                      "assignedSites",
                      `Saved — ${draftAssigned.length} assigned site${draftAssigned.length === 1 ? "" : "s"}.`,
                      () => setEmployeeSites({ userId: person._id as never, siteIds: draftAssigned as never }),
                    )
                  }
                  className="btn-surgical btn-surgical-mint min-h-[44px] self-start px-4 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  {busy === "assignedSites" ? "Saving…" : "Save sites"}
                </button>
              )}
            </div>

            {isManager && (
              <div className="flex flex-col gap-1.5 border-t border-[var(--line)] pt-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">
                    Supervised sites
                  </span>
                  {serverManaged !== undefined && (
                    <span className="text-xs text-[var(--cyan)]">
                      {draftManaged.length} supervised
                    </span>
                  )}
                </div>
                {serverManaged === undefined ? (
                  <p className="text-xs text-[var(--fog)]">Loading supervised sites…</p>
                ) : (
                  <SiteToggleGroup
                    sites={sites}
                    selectedIds={draftManaged}
                    ariaLabel="Supervised sites"
                    accent="cyan"
                    disabled={busy === "managedSites"}
                    onToggle={(siteId) => {
                      setSiteNote(null);
                      setDraftManaged((prev) => toggleSiteId(prev, siteId));
                    }}
                  />
                )}
                {(managedDirty || busy === "managedSites") && (
                  <button
                    type="button"
                    disabled={busy === "managedSites"}
                    onClick={() =>
                      saveSites(
                        "managedSites",
                        `Saved — supervising ${draftManaged.length} site${draftManaged.length === 1 ? "" : "s"}.`,
                        () => setManagerSites({ managerId: person._id as never, siteIds: draftManaged as never }),
                      )
                    }
                    className="btn-surgical btn-surgical-mint min-h-[44px] self-start px-4 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    {busy === "managedSites" ? "Saving…" : "Save supervised sites"}
                  </button>
                )}
              </div>
            )}

            {siteNote && (
              <p
                role={siteNote.tone === "err" ? "alert" : "status"}
                className={`text-xs font-semibold ${siteNote.tone === "err" ? "text-[var(--danger)]" : "text-[var(--mint)]"}`}
              >
                {siteNote.text}
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-1.5">
          <label htmlFor="drawer-msg" className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">
            Message
          </label>
          <textarea
            id="drawer-msg"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={`Message ${person?.name ?? "employee"}…`}
            className="input-surgical px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy === "msg" || !text.trim() || deactivated}
            onClick={() =>
              run("msg", "Message sent.", () => reply({ recipientId: focusUserId as never, content: text }), () => setText(""))
            }
            className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busy === "msg" ? "Sending…" : "Send message"}
          </button>
        </section>

        {shift && (
          <section className="flex flex-col gap-1.5 rounded-lg border border-[var(--line)] p-2.5">
            <button
              type="button"
              onClick={() => {
                setEndOpen(!endOpen);
                setEndWhen(toLocalInput(Date.now()));
              }}
              className="btn-surgical min-h-[44px] px-3 py-2 text-xs font-semibold text-[var(--hivis)]"
            >
              {endOpen ? "Cancel" : "End this shift (override)"}
            </button>
            {endOpen && (
              <>
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
                  Corrected end (local time)
                  <input type="datetime-local" value={endWhen} onChange={(e) => setEndWhen(e.target.value)} className="input-surgical px-3 py-1.5 text-xs" />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
                  Reason (required, min 10 characters) — audited
                  <input value={endReason} onChange={(e) => setEndReason(e.target.value)} className="input-surgical px-3 py-1.5 text-xs" />
                </label>
                <button
                  type="button"
                  disabled={busy === "end" || !endWhen || endReason.trim().length < 10}
                  onClick={() =>
                    run(
                      "end",
                      "Shift ended — payroll re-derives.",
                      () => endShift({ shiftId: shift._id as never, endedAt: new Date(endWhen).getTime(), reason: endReason.trim() }),
                      () => {
                        setEndOpen(false);
                        setEndReason("");
                      },
                    )
                  }
                  className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  {busy === "end" ? "Saving…" : "Save override"}
                </button>
              </>
            )}
          </section>
        )}

        {person && !deactivated && (
          <section className="flex flex-col gap-2 rounded-lg border border-[var(--line)] p-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fog)]">
              Rate/h <RateCell userId={person._id as never} initial={person.hourlyRateOverride} />
              Locale <LocaleCell userId={person._id as never} initial={person.locale ?? "en-ZA"} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {person.deviceId && <ResetDeviceButton userId={person._id as never} />}
              <button
                type="button"
                disabled={busy === "role" || (!isManager && !!shift)}
                title={!isManager && shift ? "Cannot promote mid-shift" : undefined}
                onClick={() =>
                  run(
                    "role",
                    isManager ? "Demoted to employee." : "Promoted to manager — their assigned sites are now supervised.",
                    () => (isManager ? demote({ userId: person._id as never }) : promote({ userId: person._id as never })),
                  )
                }
                className="btn-surgical rounded px-2 py-1 text-xs text-[var(--fog)] hover:text-[var(--paper)] disabled:opacity-50"
              >
                {isManager ? "demote to employee" : "promote to manager"}
              </button>
              <DeactivateButton userId={person._id} />
            </div>
          </section>
        )}

        {note && (
          <p role={note.tone === "err" ? "alert" : "status"} className={`text-xs font-semibold ${note.tone === "err" ? "text-[var(--danger)]" : "text-[var(--mint)]"}`}>
            {note.text}
          </p>
        )}
      </div>
    </FocusTrapModal>
  );
}
