"use client";

import { useState } from "react";
import { useAction } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { ConsoleWindow } from "@/components/console/window";
import { errMsg } from "@/lib/errors";
import { useOrg } from "./org-context";

/* ─────────────────────────── Provision panel ─────────────────────────── */

export function ProvisionPanel() {
  const provisionEmployeeAction = useAction(api.users.provisionEmployee);
  const provisionModeratorAction = useAction(api.users.provisionModerator);
  const { orgId } = useOrg();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"employee" | "moderator">("employee");
  const [code, setCode] = useState<{ email: string; idCode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <ConsoleWindow
      title="Provision account"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-2 p-3"
      aside={<span className="text-xs text-[var(--fog)]">{orgId ? "lands in selected org" : "no org selected — account will be unscoped"}</span>}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Full name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
          className="input-surgical px-3.5 py-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Email</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email"
          className="input-surgical px-3.5 py-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value as "employee" | "moderator")}
          className="input-surgical px-3.5 py-2 text-sm">
          <option value="employee">Employee</option>
          <option value="moderator">Moderator</option>
        </select>
      </label>
      <button
        data-loading={busy}
        aria-busy={busy}
        disabled={busy || !name || !email}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const fn = role === "employee" ? provisionEmployeeAction : provisionModeratorAction;
            setCode(
              role === "employee"
                ? await fn({ name, email, orgId: orgId ?? undefined } as { name: string; email: string })
                : await fn({ name, email })
            );
            setName("");
            setEmail("");
          } catch (e) {
            setError(errMsg(e));
          } finally {
            setBusy(false);
          }
        }}
        className="btn-surgical btn-surgical-mint min-h-[44px] flex-none px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        <span className="btn-label">Create account + ID code ({role})</span>
        <span className="btn-spinner" aria-hidden="true" />
      </button>
      {error && <p className="flex-none text-xs text-[var(--danger)]">{error}</p>}
      {code && (
        <div className="card-subpanel flex-none border-[var(--mint)]/60 bg-[var(--mint)]/10 p-2.5 text-xs text-[var(--paper)]">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--mint)]">Shown once — hand over NOW:</p>
          <p className="truncate">Email: <strong>{code.email}</strong></p>
          <p>ID code: <strong className="tnum font-mono tracking-widest text-[var(--mint)]">{code.idCode}</strong></p>
          <button
            onClick={() => navigator.clipboard.writeText(`${code.email}: ${code.idCode}`)}
            className="btn-surgical mt-1.5 px-3 py-1 text-xs font-semibold border-[var(--mint)]/40 text-[var(--mint)] hover:bg-[var(--mint)]/10"
          >
            copy
          </button>
        </div>
      )}
    </ConsoleWindow>
  );
}

