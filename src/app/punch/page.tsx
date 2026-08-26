export const dynamic = 'force-dynamic';
export default function PunchPage() {
  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="text-center text-sm">
        <h1 className="text-xl font-bold mb-4">Punch Clock</h1>
        <p className="text-neutral-400 mb-2">[DRAFT] Clock In / Clock Out. Geo gate: 1-mile radius of site (convex/sites.ts `geofenceRadiusMeters`). Calls `convex/punches.ts` `recordPunch` mutation.</p>
        <div className="flex gap-3 justify-center mt-4">
          <button className="rounded border border-neutral-700 px-4 py-2 text-sm" disabled>Clock In</button>
          <button className="rounded border border-neutral-700 px-4 py-2 text-sm" disabled>Clock Out</button>
        </div>
        <p className="text-xs text-neutral-600 mt-6">Status: degraded — buttons stubbed; GPS + mutation wiring deferred (subagent unavailable; parent-session build capped).</p>
      </div>
    </main>
  );
}
