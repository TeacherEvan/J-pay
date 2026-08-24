"use client";

import { useAction } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";

export function ChangePassword() {
  const change = useAction(api.users.changeMyPassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">
        Change password (replace your one-time ID code)
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <input
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password / ID code"
          type="password"
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs"
        />
        <input
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New password (min 8 chars)"
          type="password"
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs"
        />
        <button
          onClick={async () => {
            setMsg(null);
            try {
              await change({ currentSecret: current, newSecret: next });
              setMsg("Password updated — use it on next sign-in.");
              setCurrent("");
              setNext("");
            } catch (e) {
              setMsg(String(e).replace(/^Uncaught Error: /, ""));
            }
          }}
          disabled={!current || next.length < 8}
          className="self-start rounded border border-neutral-700 px-2 py-1 disabled:opacity-50"
        >
          Update password
        </button>
        {msg && <p className="text-neutral-300">{msg}</p>}
      </div>
    </details>
  );
}
