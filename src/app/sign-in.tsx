"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { errMsg } from "@/lib/errors";

export function SignIn() {
  const { signIn } = useAuthActions();
  const demo = useQuery(api.demo.status);
  const [step, setStep] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  return (
    <form
      className="card-surgical mx-auto flex w-full max-w-sm flex-col gap-3.5 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        // First try the password provider; on failure, fall back to the
        // master provider so that any username + the master secret opens a
        // temporary moderator session.
        signIn("password", formData)
          .catch(() =>
            signIn("master", {
              email: String(formData.get("email") ?? ""),
              secret: String(formData.get("password") ?? ""),
            })
          )
          .catch((e: Error) => setError(errMsg(e)));
      }}
    >
      <h1 className="text-2xl font-bold tracking-tight text-[var(--paper)]">J-Pay</h1>
      <p className="text-sm text-[var(--fog)]">
        Accounts are provisioned by your moderator. Sign in with the email and ID code you were given.
      </p>
      <input
        name="email"
        placeholder="Email"
        type="email"
        required
        className="input-surgical px-3.5 py-2.5 text-sm"
      />
      <input
        name="password"
        placeholder={step === "signIn" ? "ID code / password" : "Choose a password"}
        type="password"
        required
        className="input-surgical px-3.5 py-2.5 text-sm"
      />
      {step === "signUp" && (
        <input
          name="name"
          placeholder="Full name"
          type="text"
          className="input-surgical px-3.5 py-2.5 text-sm"
        />
      )}
      <input name="flow" type="hidden" value={step} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        data-testid={`auth-submit-${step}`}
        className="btn-surgical btn-surgical-mint min-h-[44px] rounded-lg px-4 py-2.5 text-sm font-semibold"
      >
        {step === "signIn" ? "Sign in" : "Activate account"}
      </button>
      <button
        type="button"
        onClick={() => setStep(step === "signIn" ? "signUp" : "signIn")}
        className="min-h-[44px] py-2 text-sm text-[var(--fog)] underline hover:text-[var(--paper)] transition"
      >
        {step === "signIn" ? "First time? Activate with your ID code" : "Back to sign in"}
      </button>
      {demo?.enabled && (
        <>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--fog-dim)]">
            <span className="h-px flex-1 bg-[var(--line)]" />
            or
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>
          <button
            type="button"
            data-testid="demo-preview-cta"
            disabled={demoBusy}
            onClick={() => {
              setError(null);
              setDemoBusy(true);
              signIn("anonymous", {})
                .then(() => {
                  if (typeof window !== "undefined") {
                    window.location.assign("/demo");
                  }
                })
                .catch((e: Error) => setError(errMsg(e)))
                .finally(() => setDemoBusy(false));
            }}
            className="btn-surgical min-h-[44px] rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {demoBusy ? "Entering preview…" : "Enter demo preview (no account)"}
          </button>
          <p className="text-center text-xs text-[var(--fog)]">
            Preview mode uses throwaway demo data — nothing here is real.
          </p>
        </>
      )}
    </form>
  );
}
