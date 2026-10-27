"use client";

export const dynamic = "force-dynamic";
import { useState, FormEvent } from "react";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";
import { useQuery } from "convex/react";
import { errMsg } from "@/lib/errors";

export default function LoginPage() {
  const auth = useConvexAuth() ?? { isLoading: true, isAuthenticated: false };
  const { signIn } = useAuthActions();
  const employees = useQuery(api.users_queries.listEmployees) ?? [];
  const [selectedEmail, setSelectedEmail] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [signInId, setSignInId] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const effectiveEmail = selectedEmail || manualEmail.trim();

  if (auth.isLoading) {
    return (
      <main className="min-h-dvh grid place-items-center p-6">
        <div className="text-center text-sm animate-pulse">
          <div className="h-8 bg-neutral-800 w-48 mx-auto rounded mb-4" />
          <div className="h-4 bg-neutral-800 w-64 mx-auto rounded" />
        </div>
      </main>
    );
  }

  if (auth.isAuthenticated) {
    return (
      <main className="min-h-dvh grid place-items-center p-6">
        <div className="text-center text-sm">
          <p className="text-green-400 mb-4">Signed in. Redirecting…</p>
        </div>
      </main>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!effectiveEmail || !signInId.trim()) {
      setError("Please provide your email and sign-in ID");
      return;
    }
    setIsSubmitting(true);
    try {
      await signIn("password", {
        email: effectiveEmail,
        password: signInId.trim(),
        flow: "signIn",
      });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-sm card-surgical p-6 shadow-2xl">
        <h1 className="text-xl font-bold mb-6 text-center tracking-tight text-[var(--paper)]">Employee Sign In</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-xs font-mono text-red-400 bg-red-950/20 border border-red-500/30 rounded p-3" role="alert">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="employee" className="block text-xs font-mono uppercase tracking-wider text-[var(--paper-dim)] mb-1">
              Your Name
            </label>
            <select
              id="employee"
              value={selectedEmail}
              onChange={(e) => {
                setSelectedEmail(e.target.value);
                if (e.target.value) setManualEmail("");
              }}
              className="input-surgical w-full min-h-[44px]"
            >
              <option value="">{employees.length === 0 ? "— Enter email below —" : "— Select —"}</option>
              {employees.map((emp: { _id: string; name?: string; email?: string }) => (
                <option key={emp._id} value={emp.email ?? ""}>
                  {emp.name ?? "Unknown"} ({emp.email ?? "no email"})
                </option>
              ))}
            </select>
          </div>
          {employees.length === 0 && (
            <div>
              <label htmlFor="manualEmail" className="block text-xs font-mono uppercase tracking-wider text-[var(--paper-dim)] mb-1">
                Email Address
              </label>
              <input
                id="manualEmail"
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="name@company.com"
                autoComplete="email"
                className="input-surgical w-full min-h-[44px]"
              />
            </div>
          )}
          <div>
            <label htmlFor="signInId" className="block text-xs font-mono uppercase tracking-wider text-[var(--paper-dim)] mb-1">
              Sign-In ID (Mod-assigned)
            </label>
            <input
              id="signInId"
              type="password"
              value={signInId}
              onChange={(e) => setSignInId(e.target.value)}
              required
              autoComplete="off"
              placeholder="JP-XXXXXXXXXX"
              className="input-surgical w-full min-h-[44px] font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !effectiveEmail || !signInId.trim()}
            className="btn-surgical-mint w-full rounded py-2.5 text-xs font-semibold uppercase tracking-wider min-h-[44px]"
          >
            {isSubmitting ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <p className="text-xs font-mono text-[var(--paper-dimmer)] text-center mt-6">
          Don&apos;t have a sign-in ID? Contact your moderator.
        </p>
      </div>
    </main>
  );
}