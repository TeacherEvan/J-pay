"use client";

import { useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { ModeratorsControl } from "./moderators-modal";
import { OrgPanel } from "./org-panel";
import { useOrg } from "./org-context";

type OrgRow = { _id: string; name: string; siteCount: number; userCount: number };

/** Header control: the organisation every console view is scoped to. */
export function OrgSwitcher() {
  const orgs = useQuery(api.organisations.listOrgs) as OrgRow[] | undefined;
  const { orgId, setOrgId } = useOrg();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-h-[44px] items-center gap-2 text-xs text-[var(--fog)]">
        <span className="font-semibold uppercase tracking-wider">Organisation</span>
        <select
          data-testid="org-switcher"
          value={orgId ?? ""}
          onChange={(e) => setOrgId(e.target.value || null)}
          className="input-surgical min-h-[44px] max-w-[14rem] px-3 py-1.5 text-sm font-semibold text-[var(--paper)]"
        >
          <option value="">{orgs === undefined ? "Loading…" : "Select…"}</option>
          {(orgs ?? []).map((o) => (
            <option key={o._id} value={o._id}>
              {o.name} ({o.userCount} users · {o.siteCount} sites)
            </option>
          ))}
        </select>
      </label>
      <ModeratorsControl />
    </div>
  );
}

/**
 * Shown instead of the tabs until an organisation is selected (or created).
 * Organisations are the umbrella: nothing below it can be viewed without one.
 */
export function OrgGate() {
  const orgs = useQuery(api.organisations.listOrgs) as OrgRow[] | undefined;
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col gap-3 p-2 sm:p-4" data-testid="org-gate">
      <div className="flex flex-none flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight text-[var(--paper)]">Choose an organisation</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {orgs !== undefined && orgs.length === 0
              ? "No organisation exists yet. Create one — its sites, managers and employees live inside it, and nobody outside it can see them."
              : "Everything in the console — live crew, payroll, audit, messages — is scoped to one organisation. Pick the one you want to work in."}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <ModeratorsControl />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <OrgPanel />
      </div>
    </div>
  );
}
