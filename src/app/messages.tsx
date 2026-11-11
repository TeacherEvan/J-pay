"use client";

import { useMutation, useQuery, useQueryResult } from "@/lib/backend/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatTime, formatDateTime } from "@/lib/format";
import { useUserLocale } from "@/lib/use-user-locale";
import { ConsoleWindow } from "@/components/console/window";
import { QueryError } from "@/components/console/query-error";
import { Pager } from "@/components/console/pager";
import { usePagination } from "@/components/console/use-pagination";
import { errMsg } from "@/lib/errors";

export function MessagesPanel({ role, className }: { role: "employee" | "moderator"; className?: string }) {
  const { data: inboxData, error: inboxError, retry: retryInbox } = useQueryResult<any[]>(api.messages.myInbox);
  const { data: modInboxData, error: modInboxError, retry: retryModInbox } = useQueryResult<any[]>(
    api.messages.moderatorInbox,
    role === "moderator" ? {} : "skip"
  );
  const inbox = inboxData === null ? undefined : (inboxData as any[] | undefined);
  const modInbox = modInboxData === null ? undefined : (modInboxData as any[] | undefined);
  const inboxErr = inboxError ?? modInboxError;
  const retryList = role === "moderator" ? retryModInbox : retryInbox;
  const sendToModerators = useMutation(api.messages.sendToModerators);
  const replyToEmployee = useMutation(api.messages.replyToEmployee);
  const broadcast = useMutation(api.messages.broadcast);
  const markThreadRead = useMutation(api.messages.markThreadRead);
  const markQueueItemRead = useMutation(api.messages.markQueueItemRead);
  const [text, setText] = useState("");
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [broadcastText, setBroadcastText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [replyBusy, setReplyBusy] = useState<Record<string, boolean>>({});
  const seenUnread = useRef(false);
  const userLocale = useUserLocale();
  const inboxPages = usePagination((role === "moderator" ? modInbox : inbox) ?? [], 2);

  useEffect(() => {
    if (role === "employee" && inbox && inbox.some((m: any) => !m.isRead) && !seenUnread.current) {
      seenUnread.current = true;
      void markThreadRead();
    }
  }, [inbox, markThreadRead, role]);

  if (role === "employee") {
    return (
      <section className="card-surgical flex flex-col gap-3 p-4">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">Messages</h2>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="msg-employee">Message your moderator</label>
          <input
            id="msg-employee"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message your moderator…"
            className="input-surgical flex-1 px-3 py-2 text-sm"
          />
          <button
            onClick={async () => {
              if (!text.trim() || sendBusy) return;
              setSendBusy(true);
              try {
                await sendToModerators({ content: text });
                setText("");
                setMsg("Sent to moderator.");
              } catch (e) {
                setMsg(errMsg(e));
              } finally {
                setSendBusy(false);
              }
            }}
            disabled={sendBusy || !text.trim()}
            className="btn-surgical btn-surgical-light min-h-[44px] px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {sendBusy ? "Sending…" : "Send"}
          </button>
        </div>
        {msg && <p role="status" aria-live="polite" className="text-sm font-medium text-[var(--paper)]">{msg}</p>}
        {inboxErr && <QueryError error={inboxErr} onRetry={retryList} label="Messages" />}
        {(inbox ?? []).map((m: any) => (
          <p key={m._id} className={`card-subpanel px-3 py-2 text-sm ${m.isRead ? "text-[var(--fog)]" : "text-[var(--mint)] border-[var(--mint)]/40 bg-[var(--mint)]/10"}`}>
            <span className="tnum mr-2 text-xs opacity-70">{formatTime(m._creationTime, userLocale)}</span>
            {m.content}
          </p>
        ))}
      </section>
    );
  }

  return (
    <ConsoleWindow title="Messages" className={`h-full ${className ?? ""}`} bodyClassName="flex min-h-0 flex-col gap-2 p-3">
      <div className="flex flex-none gap-2">
        <label className="sr-only" htmlFor="msg-broadcast">Broadcast to all employees</label>
        <input
          id="msg-broadcast"
          value={broadcastText}
          onChange={(e) => setBroadcastText(e.target.value)}
          placeholder="Broadcast to all employees…"
          className="input-surgical flex-1 px-3 py-2 text-xs"
        />
        <button
          onClick={async () => {
            if (!broadcastText.trim() || broadcastBusy) return;
            setBroadcastBusy(true);
            try {
              await broadcast({ content: broadcastText });
              setBroadcastText("");
              setMsg("Broadcast sent.");
            } catch (e) {
              setMsg(errMsg(e));
            } finally {
              setBroadcastBusy(false);
            }
          }}
          disabled={broadcastBusy || !broadcastText.trim()}
          className="btn-surgical btn-surgical-mint min-h-[44px] flex-none px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {broadcastBusy ? "Sending…" : "Broadcast"}
        </button>
      </div>
      {msg && <p role="status" aria-live="polite" className="flex-none text-xs font-medium text-[var(--paper)]">{msg}</p>}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        {modInbox === undefined && <p className="text-xs text-[var(--fog)]">Loading…</p>}
        {modInbox !== undefined && modInbox.length === 0 && <p className="text-xs text-[var(--fog)]">Queue empty.</p>}
        {inboxPages.pageItems.map((m: any) => (
          <div key={m._id} className={`card-subpanel flex-none p-2 text-xs ${m.isRead ? "" : "border-l-4 border-l-[var(--mint)]"}`}>
            <p className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold text-[var(--paper)]">{m.senderName}</span>
              <span className="tnum flex-none text-xs text-[var(--fog)]">{formatDateTime(m.at, userLocale)}</span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-[var(--text-secondary)]">{m.content}</p>
            <div className="mt-1.5 flex gap-1.5">
              <label className="sr-only" htmlFor={`msg-reply-${m._id}`}>Reply to {m.senderName}</label>
              <input
                id={`msg-reply-${m._id}`}
                value={replyText[m._id] ?? ""}
                onChange={(e) => setReplyText({ ...replyText, [m._id]: e.target.value })}
                placeholder="Reply directly…"
                className="input-surgical min-w-0 flex-1 px-2.5 py-1.5 text-xs"
              />
              <button
                onClick={async () => {
                  const content = replyText[m._id];
                  if (!content?.trim() || replyBusy[m._id]) return;
                  setReplyBusy({ ...replyBusy, [m._id]: true });
                  try {
                    await replyToEmployee({ recipientId: m.senderId as Id<"users">, content });
                    await markQueueItemRead({ messageId: m._id as Id<"messages"> });
                    setReplyText({ ...replyText, [m._id]: "" });
                    setMsg("Reply sent.");
                  } catch (e) {
                    setMsg(errMsg(e));
                  } finally {
                    setReplyBusy({ ...replyBusy, [m._id]: false });
                  }
                }}
                disabled={replyBusy[m._id] || !(replyText[m._id] ?? "").trim()}
                className="btn-surgical btn-surgical-light flex-none px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                {replyBusy[m._id] ? "Sending…" : "Reply"}
              </button>
              {!m.isRead && (
                <button
                  onClick={() => void markQueueItemRead({ messageId: m._id as Id<"messages"> })}
                  className="btn-surgical flex-none px-2.5 py-1.5 text-xs"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Pager page={inboxPages.page} pageCount={inboxPages.pageCount} total={inboxPages.total} onPage={inboxPages.setPage} label="Inbox" />
    </ConsoleWindow>
  );
}
