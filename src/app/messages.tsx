"use client";

import { useMutation, useQuery } from "@/lib/backend/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatTime, formatDateTime } from "@/lib/format";
import { useUserLocale } from "@/lib/use-user-locale";

export function MessagesPanel({ role }: { role: "employee" | "moderator" }) {
  const inbox = useQuery(api.messages.myInbox);
  const modInbox = useQuery(
    api.messages.moderatorInbox,
    role === "moderator" ? {} : "skip"
  );
  const sendToModerators = useMutation(api.messages.sendToModerators);
  const replyToEmployee = useMutation(api.messages.replyToEmployee);
  const broadcast = useMutation(api.messages.broadcast);
  const markThreadRead = useMutation(api.messages.markThreadRead);
  const markQueueItemRead = useMutation(api.messages.markQueueItemRead);
  const [text, setText] = useState("");
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [broadcastText, setBroadcastText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const seenUnread = useRef(false);
  const userLocale = useUserLocale();

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
              if (!text.trim()) return;
              await sendToModerators({ content: text });
              setText("");
              setMsg("Sent to moderator.");
            }}
            className="btn-surgical btn-surgical-light min-h-[44px] px-4 py-2 text-sm font-semibold"
          >
            Send
          </button>
        </div>
        {msg && <p role="status" aria-live="polite" className="text-sm font-medium text-[var(--paper)]">{msg}</p>}
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
    <section className="card-surgical flex flex-col gap-3.5 p-5">
      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">Messages</h2>
      <div className="flex gap-2.5">
        <label className="sr-only" htmlFor="msg-broadcast">Broadcast to all employees</label>
        <input
          id="msg-broadcast"
          value={broadcastText}
          onChange={(e) => setBroadcastText(e.target.value)}
          placeholder="Broadcast to all employees…"
          className="input-surgical flex-1 px-3.5 py-2 text-sm"
        />
        <button
          onClick={async () => {
            if (!broadcastText.trim()) return;
            await broadcast({ content: broadcastText });
            setBroadcastText("");
            setMsg("Broadcast sent.");
          }}
          className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-2 text-sm font-semibold"
        >
          Broadcast
        </button>
      </div>
      {(modInbox ?? []).length === 0 && <p className="text-sm text-[var(--fog)]">Queue empty.</p>}
      {(modInbox ?? []).map((m: any) => (
        <div key={m._id} className={`card-subpanel p-3.5 text-sm ${m.isRead ? "" : "border-l-4 border-l-[var(--mint)]"}`}>
          <p className="flex items-baseline justify-between">
            <span className="font-semibold text-[var(--paper)]">{m.senderName}</span>
            <span className="tnum text-xs text-[var(--fog)]">{formatDateTime(m.at, userLocale)}</span>
          </p>
          <p className="mt-1.5 text-[var(--text-secondary)]">{m.content}</p>
          <div className="mt-2.5 flex gap-2">
            <label className="sr-only" htmlFor={`msg-reply-${m._id}`}>Reply to {m.senderName}</label>
            <input
              id={`msg-reply-${m._id}`}
              value={replyText[m._id] ?? ""}
              onChange={(e) => setReplyText({ ...replyText, [m._id]: e.target.value })}
              placeholder="Reply directly…"
              className="input-surgical flex-1 px-3 py-1.5 text-xs"
            />
            <button
              onClick={async () => {
                const content = replyText[m._id];
                if (!content?.trim()) return;
                await replyToEmployee({ recipientId: m.senderId as Id<"users">, content });
                await markQueueItemRead({ messageId: m._id as Id<"messages"> });
                setReplyText({ ...replyText, [m._id]: "" });
                setMsg("Reply sent.");
              }}
              className="btn-surgical btn-surgical-light px-3.5 py-1.5 text-xs font-semibold"
            >
              Reply
            </button>
            {!m.isRead && (
              <button
                onClick={() => void markQueueItemRead({ messageId: m._id as Id<"messages"> })}
                className="btn-surgical px-3 py-1.5 text-xs"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      ))}
      {msg && <p role="status" aria-live="polite" className="text-sm font-medium text-[var(--paper)]">{msg}</p>}
    </section>
  );
}
