"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { errMsg } from "@/lib/errors";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [step, setStep] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mx-auto flex w-full max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        signIn("password", formData).catch((e: Error) =>
          setError(errMsg(e))
        );
      }}
    >
      <h1 className="text-2xl font-semibold">J-Pay</h1>
      <p className="text-sm text-neutral-400">
        Accounts are provisioned by your moderator. Sign in with the email and ID code you were given.
      </p>
      <input name="email" placeholder="Email" type="email" required className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600" />
      <input name="password" placeholder={step === "signIn" ? "ID code / password" : "Choose a password"} type="password" required className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600" />
      {step === "signUp" && (
        <input name="name" placeholder="Full name" type="text" className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600" />
      )}
      <input name="flow" type="hidden" value={step} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400">
        {step === "signIn" ? "Sign in" : "Activate account"}
      </button>
      <button
        type="button"
        onClick={() => setStep(step === "signIn" ? "signUp" : "signIn")}
        className="text-xs text-neutral-400 underline hover:text-neutral-200"
      >
        {step === "signIn" ? "First time? Activate with your ID code" : "Back to sign in"}
      </button>
    </form>
  );
}
