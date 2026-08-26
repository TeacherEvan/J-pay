export const dynamic = 'force-dynamic';
import { useConvexAuth, AuthLoading, Authenticated, Unauthenticated } from "convex/react";
export default function LoginPage() {
  const auth = useConvexAuth() ?? { isLoading: true, isAuthenticated: false };
  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="text-center text-sm">
        <h1 className="text-xl font-bold mb-4">Employee Sign In</h1>
        <p className="text-neutral-400 mb-4">[DRAFT] Select your name + sign-in ID (Mod-assigned). Geo-clock feature: /punch page (Task 4, next).</p>
        <p className="text-xs text-neutral-600">Status: degraded deliverable — login UI stub; Convex Auth provider present (`auth ?? {}` guard for SSR).</p>
      </div>
    </main>
  );
}
