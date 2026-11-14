"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { ConsoleWindow } from "@/components/console/window";
import { errMsg } from "@/lib/errors";
import { useOrg } from "./org-context";

type OrgRow = { _id: string; name: string; siteCount: number; userCount: number };

/**
 * Organisations come first: create or select an org, then sites are created
 * inside it (see SitePanel) and provisioned users land in it (see ProvisionPanel).
 */
export function OrgPanel() {
  const orgs = useQuery(api.organisations.listOrgs) as OrgRow[] | undefined;
  const createOrg = useMutation(api.organisations.createOrg);
  const archiveOrg = useMutation(api.organisations.archiveOrg);
  const { orgId, setOrgId } = useOrg();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Auto-select the only org when there is exactly one and none is chosen yet.
  const soloId = orgs && orgs.length === 1 ? orgs[0]._id : null;
  useEffect(() => {
    if (soloId && orgId === null) setOrgId(soloId);
  }, [soloId, orgId, setOrgId]);

  return (
    <ConsoleWindow
      title="Organisations"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-2 p-3"
      aside={<span className="text-xs text-[var(--fog)]">sites &amp; users live inside an org</span>}
    >
      <form
        className="flex flex-none gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          setMsg(null);
          try {
            const id = (await createOrg({ name: name.trim() })) as unknown as string;
            setOrgId(String(id));
            setName("");
            setMsg("Organisation created — it is now selected.");
          } catch (err) {
            setMsg(errMsg(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="sr-only" htmlFor="org-name">Organisation name</label>
        <input
          id="org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New organisation name…"
          className="input-surgical min-w-0 flex-1 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          data-loading={busy}
          aria-busy={busy}
          disabled={busy || !name.trim()}
          className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          <span className="btn-label">Create org</span>
          <span className="btn-spinner" aria-hidden="true" />
        </button>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {orgs === undefined ? (
          <p className="text-sm text-[var(--fog)]">Loading organisations…</p>
        ) : orgs.length === 0 ? (
          <p className="text-sm text-[var(--fog)]">
            No organisation yet — create one above. Sites and accounts are created inside it afterwards.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {orgs.map((o) => {
              const selected = orgId === o._id;
              return (
                <li key={o._id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selected) setOrgId(o._id);
                    }}
                    aria-pressed={selected}
                    className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                      selected
                        ? "cursor-default border-[var(--mint)]/60 bg-[var(--mint)]/10 text-[var(--paper)]"
                        : "cursor-pointer border-[var(--line)] text-[var(--text-secondary)] hover:bg-[var(--panel-elevated)]/40"
                    }`}
                  >
                    <span className="min-w-0 truncate font-semibold">{o.name}</span>
                    <span className="flex flex-none items-center gap-2 text-xs text-[var(--fog)]">
                      <span className="tnum">{o.siteCount} sites · {o.userCount} users</span>
                      {selected && <span className="text-[var(--mint)]">selected</span>}
                    </span>
                  </button>
                  {selected && (
                    <div className="mt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await archiveOrg({ orgId: o._id as never });
                            setOrgId(null);
                            setMsg(`Archived ${o.name}. Sites and users are kept for audit.`);
                          } catch (err) {
                            setMsg(errMsg(err));
                          }
                        }}
                        className="text-xs text-[var(--fog)] underline hover:text-[var(--danger)]"
                      >
                        archive organisation
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {msg && <p className="flex-none truncate text-xs text-[var(--fog)]">{msg}</p>}
    </ConsoleWindow>
  );
}
