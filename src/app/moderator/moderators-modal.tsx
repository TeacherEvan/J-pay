"use client";

import { useId, useState } from "react";
import { useAction, useMutation, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { FocusTrapModal } from "@/components/console/focus-trap-modal";
import { errMsg } from "@/lib/errors";

type ModeratorRow = {
  _id: string;
  name?: string | null;
  email?: string | null;
  isActive: boolean;
  archivedAt?: number;
  hasChangedPassword?: boolean;
};

type MeRow = {
  _id: string;
  name?: string | null;
  email?: string | null;
  role?: string;
};

/**
 * Trigger button + focus-trapped modal for viewing, provisioning, and
 * deactivating platform-level moderators (global across all organisations).
 */
export function ModeratorsControl() {
  const me = useQuery(api.users_queries.me) as MeRow | null | undefined;
  const mods = useQuery(api.users_queries.listModerators, {}) as ModeratorRow[] | undefined;
  const provisionModerator = useAction(api.users.provisionModerator);
  const deactivateModerator = useMutation(api.users.deactivateModerator);

  const formId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; idCode: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeCount = (mods ?? []).filter((m) => m.isActive && m.archivedAt === undefined).length;

  function closeModal() {
    setOpen(false);
    setFormError(null);
    setCreated(null);
    setCopied(false);
    setConfirmId(null);
    setActionError(null);
  }

  return (
    <>
      <button
        type="button"
        data-testid="open-moderators-modal"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="btn-surgical min-h-[44px] rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--paper)]"
      >
        {mods === undefined ? "Moderators" : `Moderators (${activeCount})`}
      </button>

      {open && (
        <FocusTrapModal
          labelledBy="moderators-modal-title"
          onClose={closeModal}
          className="card-surgical flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden p-4 shadow-2xl sm:p-5"
        >
          <header className="flex flex-none items-start justify-between gap-3 border-b border-[var(--line)] pb-3">
            <div className="min-w-0">
              <h2 id="moderators-modal-title" className="text-lg font-bold tracking-tight text-[var(--paper)]">
                Platform moderators
              </h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Platform moderators have global access across all organisations and do not belong to any single organisation.
              </p>
            </div>
            <button
              type="button"
              onClick={closeModal}
              aria-label="Close"
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-lg text-[var(--fog)] transition hover:text-[var(--paper)]"
            >
              ✕
            </button>
          </header>

          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-0.5">
            <section className="card-subpanel flex-none p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">
                Provision platform moderator
              </h3>
              <form
                className="mt-2.5 flex flex-col gap-2.5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const trimmedName = name.trim();
                  const trimmedEmail = email.trim();
                  if (!trimmedName || !trimmedEmail) return;
                  setCreating(true);
                  setFormError(null);
                  setCreated(null);
                  setCopied(false);
                  try {
                    const res = (await provisionModerator({
                      name: trimmedName,
                      email: trimmedEmail,
                    })) as { email: string; idCode: string };
                    setCreated(res);
                    setName("");
                    setEmail("");
                  } catch (err) {
                    setFormError(errMsg(err));
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`${formId}-name`}
                      className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]"
                    >
                      Full name
                    </label>
                    <input
                      id={`${formId}-name`}
                      type="text"
                      required
                      maxLength={100}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full name"
                      className="input-surgical min-h-[44px] px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`${formId}-email`}
                      className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]"
                    >
                      Email
                    </label>
                    <input
                      id={`${formId}-email`}
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="moderator@company.com"
                      className="input-surgical min-h-[44px] px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end">
                  <button
                    type="submit"
                    data-loading={creating}
                    aria-busy={creating}
                    disabled={creating || !name.trim() || !email.trim()}
                    className="btn-surgical btn-surgical-mint min-h-[44px] w-full px-4 py-2 text-sm font-semibold disabled:opacity-50 sm:w-auto"
                  >
                    <span className="btn-label">Create moderator</span>
                    <span className="btn-spinner" aria-hidden="true" />
                  </button>
                </div>
              </form>

              {formError && (
                <p role="alert" className="mt-2 text-xs font-medium text-[var(--danger)]">
                  {formError}
                </p>
              )}

              {created && (
                <div
                  role="status"
                  className="mt-2.5 flex flex-col gap-2 rounded-lg border border-[var(--mint)]/60 bg-[var(--mint)]/10 p-3 text-xs text-[var(--paper)] sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--mint)]">
                      One-time ID code — shown once
                    </p>
                    <p className="mt-0.5 truncate">
                      Email: <strong>{created.email}</strong>
                    </p>
                    <p className="mt-0.5">
                      ID code:{" "}
                      <strong className="tnum font-mono tracking-widest text-[var(--mint)]">
                        {created.idCode}
                      </strong>
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      Hand this code over securely now — they must change their password on first login.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(`${created.email}: ${created.idCode}`);
                        setCopied(true);
                      } catch {
                        // Clipboard unavailable in restricted contexts
                      }
                    }}
                    className="btn-surgical min-h-[44px] shrink-0 border-[var(--mint)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--mint)] hover:bg-[var(--mint)]/10"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">
                  Current moderators
                </h3>
                {mods !== undefined && (
                  <span className="tnum text-xs text-[var(--fog)]">
                    {activeCount} active · {mods.length} total
                  </span>
                )}
              </div>

              {actionError && (
                <p role="alert" className="text-xs font-medium text-[var(--danger)]">
                  {actionError}
                </p>
              )}

              {mods === undefined ? (
                <p className="text-sm text-[var(--fog)]">Loading moderators…</p>
              ) : mods.length === 0 ? (
                <p className="text-sm text-[var(--fog)]">No platform moderators found.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {mods.map((m) => {
                    const isActive = m.isActive && m.archivedAt === undefined;
                    const isSelf = me?._id !== undefined && m._id === me._id;
                    const canDeactivate = isActive && !isSelf && activeCount > 1;
                    const confirming = confirmId === m._id;
                    const busy = deactivatingId === m._id;

                    return (
                      <li
                        key={m._id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)]/70 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-[var(--paper)]">
                              {m.name ?? m.email ?? "Moderator"}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                                isActive
                                  ? "border-[var(--mint)]/40 text-[var(--mint)]"
                                  : "border-[var(--danger)]/40 text-[var(--danger)]"
                              }`}
                            >
                              {isActive ? "active" : "deactivated"}
                            </span>
                            {isSelf && (
                              <span className="rounded-full border border-[var(--cyan)]/40 px-2 py-0.5 text-xs font-semibold text-[var(--cyan)]">
                                you
                              </span>
                            )}
                          </div>
                          {m.email && (
                            <p className="mt-0.5 truncate text-xs text-[var(--fog)]">{m.email}</p>
                          )}
                        </div>

                        {canDeactivate && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            {confirming ? (
                              <>
                                <button
                                  type="button"
                                  data-loading={busy}
                                  aria-busy={busy}
                                  disabled={deactivatingId !== null}
                                  onClick={async () => {
                                    setDeactivatingId(m._id);
                                    setActionError(null);
                                    try {
                                      await deactivateModerator({ userId: m._id as never });
                                      setConfirmId(null);
                                    } catch (err) {
                                      setActionError(errMsg(err));
                                    } finally {
                                      setDeactivatingId(null);
                                    }
                                  }}
                                  className="btn-surgical min-h-[44px] border-[var(--danger)]/50 px-3 py-1.5 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
                                >
                                  <span className="btn-label">Confirm</span>
                                  <span className="btn-spinner" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    setConfirmId(null);
                                    setActionError(null);
                                  }}
                                  className="btn-surgical min-h-[44px] px-3 py-1.5 text-xs font-semibold text-[var(--fog)] hover:text-[var(--paper)] disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={deactivatingId !== null}
                                onClick={() => {
                                  setConfirmId(m._id);
                                  setActionError(null);
                                }}
                                className="btn-surgical min-h-[44px] px-3 py-1.5 text-xs font-semibold text-[var(--fog)] hover:border-[var(--danger)]/40 hover:text-[var(--danger)] disabled:opacity-50"
                              >
                                Deactivate
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </FocusTrapModal>
      )}
    </>
  );
}
