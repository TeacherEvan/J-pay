"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ConsoleWindow } from "@/components/console/window";
import { Pager } from "@/components/console/pager";
import { usePagination } from "@/components/console/use-pagination";
import { errMsg } from "@/lib/errors";

type OrgUser = { _id: string; name: string; email?: string; role: string };

/**
 * Manager messaging — scoped to the manager's organisation: 1:1 to any active
 * org user, or a broadcast to everyone active in the org. Not site-scoped.
 */
export function ManagerMessagesPanel() {
  const users = useQuery(api.messages.managerOrgUsers) as OrgUser[] | undefined;
  const myInbox = useQuery(api.messages.myInbox) as { _id: string; content: string; isRead: boolean; _creationTime: number }[] | undefined;
  const sendDirect = useMutation(api.messages.managerMessage);
  const broadcast = useMutation(api.messages.managerBroadcast);
  const [query, setQuery] = useState("");
  const [broadcastText, setBroadcastText] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = (users ?? []).filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q) || u.role.includes(q);
  });
  const page = usePagination(filtered, 6);
  const unread = (myInbox ?? []).filter((m) => !m.isRead).length;

  return (
    <ConsoleWindow
      title="Messages · your organisation"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-2 p-3"
      aside={<span className="text-xs text-[var(--fog)]">{unread > 0 ? `${unread} unread for you` : "everyone in your org"}</span>}
    >
      <div className="flex flex-none gap-2">
        <label className="sr-only" htmlFor="mgr-broadcast">Broadcast to everyone in your org</label>
        <input
          id="mgr-broadcast"
          value={broadcastText}
          onChange={(e) => setBroadcastText(e.target.value)}
          placeholder="Broadcast to everyone in your org…"
          className="input-surgical min-w-0 flex-1 px-3 py-2 text-xs"
        />
        <button
          disabled={!broadcastText.trim()}
          onClick={async () => {
            setMsg(null);
            try {
              const res = (await broadcast({ content: broadcastText.trim() })) as { sent: number };
              setBroadcastText("");
              setMsg(`Broadcast sent to ${res.sent} ${res.sent === 1 ? "person" : "people"}.`);
            } catch (e) {
              setMsg(errMsg(e));
            }
          }}
          className="btn-surgical btn-surgical-mint min-h-[44px] flex-none px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          Broadcast
        </button>
      </div>

      <label className="sr-only" htmlFor="mgr-msg-search">Find someone in your organisation</label>
      <input
        id="mgr-msg-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a person in your org…"
        className="input-surgical flex-none px-3 py-2 text-xs"
      />

      {msg && <p role="status" aria-live="polite" className="flex-none text-xs font-medium text-[var(--paper)]">{msg}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {users === undefined && <p className="text-xs text-[var(--fog)]">Loading your organisation…</p>}
        {users !== undefined && filtered.length === 0 && <p className="text-xs text-[var(--fog)]">No one matches.</p>}
        {page.pageItems.map((u) => (
          <div key={u._id} className="card-subpanel flex flex-none flex-wrap items-center gap-1.5 p-2 text-xs">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-[var(--paper)]">{u.name}</p>
              <p className="truncate text-[var(--fog)]">{u.email} · {u.role}</p>
            </div>
            <label className="sr-only" htmlFor={`mgr-msg-${u._id}`}>Message {u.name}</label>
            <input
              id={`mgr-msg-${u._id}`}
              value={drafts[u._id] ?? ""}
              onChange={(e) => setDrafts({ ...drafts, [u._id]: e.target.value })}
              placeholder="Message…"
              className="input-surgical min-w-0 flex-1 px-2 py-1.5 text-xs"
            />
            <button
              disabled={busyId === u._id || !(drafts[u._id] ?? "").trim()}
              onClick={async () => {
                const content = (drafts[u._id] ?? "").trim();
                if (!content) return;
                setBusyId(u._id);
                setMsg(null);
                try {
                  await sendDirect({ recipientId: u._id as Id<"users">, content });
                  setDrafts({ ...drafts, [u._id]: "" });
                  setMsg(`Sent to ${u.name}.`);
                } catch (e) {
                  setMsg(errMsg(e));
                } finally {
                  setBusyId(null);
                }
              }}
              className="btn-surgical btn-surgical-light flex-none px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              Send
            </button>
          </div>
        ))}
      </div>
      <Pager page={page.page} pageCount={page.pageCount} total={page.total} onPage={page.setPage} label="Organisation members" />
    </ConsoleWindow>
  );
}
