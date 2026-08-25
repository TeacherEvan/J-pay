"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
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
    if (role === "employee" && inbox && inbox.some((m) => !m.isRead) && !seenUnread.current) {
      seenUnread.current = true;
      void markThreadRead();
    }
  }, [inbox, markThreadRead, role]);

  if (role === "employee") {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Messages</h2>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="msg-employee">Message your moderator</label>
          <input
            id="msg-employee"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message your moderator…"
            className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
          />
          <button
            onClick={async () => {
              if (!text.trim()) return;
              await sendToModerators({ content: text });
              setText("");
              setMsg("Sent to moderator.");
            }}
            className="rounded-md bg-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-900"
          >
            Send
          </button>
        </div>
        {msg && <p role="status" aria-live="polite" className="text-xs text-neutral-400">{msg}</p>}
        {(inbox ?? []).map((m) => (
          <p key={m._id} className={`rounded-md bg-neutral-900 px-3 py-1.5 text-xs ${m.isRead ? "text-neutral-500" : "text-emerald-300"}`}>
            <span className="mr-2 opacity-60">{formatTime(m._creationTime, userLocale)}</span>
            {m.content}
          </p>
        ))}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Messages</h2>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="msg-broadcast">Broadcast to all employees</label>
        <input
          id="msg-broadcast"
          value={broadcastText}
          onChange={(e) => setBroadcastText(e.target.value)}
          placeholder="Broadcast to all employees…"
          className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
        />
        <button
          onClick={async () => {
            if (!broadcastText.trim()) return;
            await broadcast({ content: broadcastText });
            setBroadcastText("");
            setMsg("Broadcast sent.");
          }}
          className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950"
        >
          Broadcast
        </button>
      </div>
      {(modInbox ?? []).length === 0 && <p className="text-xs text-neutral-600">Queue empty.</p>}
      {(modInbox ?? []).map((m) => (
        <div key={m._id} className={`rounded-md bg-neutral-900 p-3 text-xs ${m.isRead ? "" : "border-l-2 border-emerald-500"}`}>
          <p>
            <span className="font-semibold">{m.senderName}</span>
            <span className="ml-2 text-neutral-500">{formatDateTime(m.at, userLocale)}</span>
          </p>
          <p className="mt-1 text-neutral-300">{m.content}</p>
          <div className="mt-2 flex gap-2">
            <label className="sr-only" htmlFor={`msg-reply-${m._id}`}>Reply to {m.senderName}</label>
            <input
              id={`msg-reply-${m._id}`}
              value={replyText[m._id] ?? ""}
              onChange={(e) => setReplyText({ ...replyText, [m._id]: e.target.value })}
              placeholder="Reply directly…"
              className="flex-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-1"
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
              className="rounded bg-neutral-200 px-2 py-1 font-semibold text-neutral-900"
            >
              Reply
            </button>
            {!m.isRead && (
              <button
                onClick={() => void markQueueItemRead({ messageId: m._id as Id<"messages"> })}
                className="rounded border border-neutral-700 px-2 py-1"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      ))}
      {msg && <p role="status" aria-live="polite" className="text-xs text-neutral-400">{msg}</p>}
    </section>
  );
}
