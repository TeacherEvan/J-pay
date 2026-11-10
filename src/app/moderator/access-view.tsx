"use client";

import { useState } from "react";
import { useOrg } from "./org-context";
import { OrgPanel } from "./org-panel";
import { ProvisionPanel } from "./provision-panel";
import { SitePanel } from "./site-panel";
import { AssignPanel } from "./assign-panel";
import { ManagersPanel } from "./managers-panel";
import type { ModeratorEmployee } from "./types";

/* ───────────────────── Access (provision / sites / scopes) ───────────────────── */

export type AccessTask = "provision" | "site" | "assign" | "managers" | "orgs";

export function AccessView({
  employees,
  sites,
}: {
  employees: ModeratorEmployee[];
  sites: { _id: string; name: string; orgId?: string }[];
}) {
  const [task, setTask] = useState<AccessTask>("provision");
  const { orgId } = useOrg();
  // Sites picked AFTER an org is created — everything below operates inside the selected org.
  const orgSites = orgId ? sites.filter((s) => s.orgId === orgId) : sites;
  const orgEmployees = orgId ? employees.filter((e) => e.orgId === orgId) : employees;
  const cell = (id: AccessTask) =>
    `min-h-0 h-full ${task === id ? "block" : "hidden"} md:block`;

  return (
    <div role="tabpanel" id="tabpanel-access" aria-labelledby="tab-access" aria-label="Access" className="flex h-full min-h-0 flex-col">
      {/* Mobile: dropdown to pick which window to show */}
      <div className="mb-2 flex-none md:hidden">
        <label className="sr-only" htmlFor="access-task-select">Access task</label>
        <select
          id="access-task-select"
          data-testid="access-task-select"
          value={task}
          onChange={(e) => setTask(e.target.value as AccessTask)}
          className="input-surgical h-11 w-full px-3.5 text-sm font-semibold"
        >
          <option value="provision">Provision account + ID code</option>
          <option value="site">Create site (geofence)</option>
          <option value="assign">Assign employee ↔ sites</option>
          <option value="managers">Managers</option>
          <option value="orgs">Organisations</option>
        </select>
      </div>
      <div className={`${task === "orgs" ? "block" : "hidden"} mb-2 flex-none md:mb-2 md:block`}>
        <div className="h-44 md:h-36">
          <OrgPanel />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2 md:grid-rows-2">
        <div className={cell("provision")}>
          <ProvisionPanel />
        </div>
        <div className={cell("site")}>
          <SitePanel />
        </div>
        <div className={cell("assign")}>
          <AssignPanel employees={orgEmployees} sites={orgSites} />
        </div>
        <div className={cell("managers")}>
          <ManagersPanel employees={orgEmployees} sites={orgSites} />
        </div>
      </div>
    </div>
  );
}

