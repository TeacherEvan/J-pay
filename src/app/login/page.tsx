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
  const [signInId, setSignInId] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    if (!selectedEmail || !signInId.trim()) {
      setError("Select your name and enter your sign-in ID");
      return;
    }
    setIsSubmitting(true);
    try {
      await signIn("password", {
        email: selectedEmail,
        secret: signInId.trim(),
      });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold mb-6 text-center">Employee Sign In</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded p-3" role="alert">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="employee" className="block text-sm font-medium mb-1">
              Your Name
            </label>
            <select
              id="employee"
              value={selectedEmail}
              onChange={(e) => setSelectedEmail(e.target.value)}
              required
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 min-h-[44px]"
            >
              <option value="">— Select —</option>
              {employees.map((emp: { _id: string; name?: string; email?: string }) => (
                <option key={emp._id} value={emp.email ?? ""}>
                  {emp.name ?? "Unknown"} ({emp.email ?? "no email"})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="signInId" className="block text-sm font-medium mb-1">
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
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 min-h-[44px]"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !selectedEmail || !signInId.trim()}
            className="w-full rounded bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-neutral-950"
          >
            {isSubmitting ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <p className="text-xs text-neutral-500 text-center mt-6">
          Don&apos;t have a sign-in ID? Contact your moderator.
        </p>
      </div>
    </main>
  );
}