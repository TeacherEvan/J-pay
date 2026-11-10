"use client";

export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useConvexAuth } from "@/lib/backend/react";
import { useMutation, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { errMsg } from "@/lib/errors";
import type { Id } from "../../../convex/_generated/dataModel";

type PunchResult = {
  punchId: string;
  geoPassed: boolean;
  durationSec?: number;
  ts: number;
} | null;

type Site = {
  _id: Id<"sites">;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
} | null;

export default function PunchPage() {
  const auth = useConvexAuth() ?? { isLoading: true, isAuthenticated: false };
  const site = useQuery(api.sites.getSiteForPunch) as Site;
  const recordPunch = useMutation(api.punches.recordPunch);
  const punchHistory = useQuery(api.punches.getPunchHistory, site ? { siteId: site._id } : "skip") ?? [];

  const [status, setStatus] = useState<"idle" | "locating" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [lastPunch, setLastPunch] = useState<PunchResult>(null);
  const [isClockingIn, setIsClockingIn] = useState(false);
  const [isClockingOut, setIsClockingOut] = useState(false);

  if (auth.isLoading) {
    return (
      <main className="min-h-dvh grid place-items-center p-6">
        <div className="text-center text-sm pulse-soft">
          <div className="h-8 bg-[var(--panel-2)] w-48 mx-auto rounded mb-4" />
          <div className="h-4 bg-[var(--panel-2)] w-64 mx-auto rounded" />
        </div>
      </main>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <main className="min-h-dvh grid place-items-center p-6">
        <div className="card-surgical max-w-sm p-6 text-center text-sm text-[var(--text-secondary)]">
          <p className="mb-4 text-[var(--paper)]">Please sign in first.</p>
          <a href="/login" className="btn-surgical-mint inline-flex px-4 py-2 text-xs font-semibold uppercase tracking-wider">
            Go to login
          </a>
        </div>
      </main>
    );
  }

  if (!site) {
    return (
      <main className="min-h-dvh grid place-items-center p-6">
        <div className="card-surgical max-w-sm p-6 text-center text-sm">
          <h1 className="text-xl font-bold mb-4 tracking-tight text-[var(--paper)]">Punch Clock</h1>
          <div className="text-xs font-mono text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded p-4">
            <p className="font-semibold uppercase tracking-wider mb-2">No Site Assigned</p>
            <p>You are not assigned to any active site. Contact your moderator.</p>
          </div>
        </div>
      </main>
    );
  }

  const handlePunch = async (type: "in" | "out") => {
    if (type === "in") setIsClockingIn(true);
    else setIsClockingOut(true);
    setStatus("locating");
    setMessage("Getting GPS location…");

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0,
        });
      });

      const { latitude, longitude, accuracy } = position.coords;

      // Client-side accuracy gate (TRD §3.1)
      if (accuracy > 50) {
        throw new Error(`GPS accuracy ${Math.round(accuracy)}m exceeds 50m limit. Move to open area.`);
      }

      setMessage(`GPS acquired (accuracy: ${Math.round(accuracy)}m). Checking geofence…`);

      const result = await recordPunch({
        siteId: site._id,
        type,
        lat: latitude,
        lng: longitude,
        accuracyMeters: accuracy,
      });

      if (result.geoPassed) {
        setStatus("success");
        const timeStr = new Date(result.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        let msg = `✓ Clocked ${type === "in" ? "In" : "Out"} at ${timeStr}`;
        if (result.durationSec !== undefined) {
          const h = Math.floor(result.durationSec / 3600);
          const m = Math.floor((result.durationSec % 3600) / 60);
          msg += ` • Shift: ${h}h ${m}m`;
        }
        setMessage(msg);
        setLastPunch(result);
      } else {
        setStatus("error");
        setMessage(`✗ Outside geofence (radius: ${site.geofenceRadiusMeters}m)`);
      }
    } catch (e) {
      setStatus("error");
      setMessage(errMsg(e));
    } finally {
      setIsClockingIn(false);
      setIsClockingOut(false);
    }
  };

  const formatDuration = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-sm card-surgical p-6 space-y-6 shadow-2xl">
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight text-[var(--paper)] mb-1">Punch Clock</h1>
          <p className="text-sm font-medium text-[var(--text-secondary)]">{site.name}</p>
          <p className="text-xs font-mono text-[var(--fog)] mt-1 tnum">
            Radius: {(site.geofenceRadiusMeters / 1000).toFixed(1)} km
          </p>
        </div>

        <div
          className={`rounded-lg border p-4 text-center transition-colors ${
            status === "success"
              ? "border-[var(--mint)]/50 bg-[var(--mint)]/10 text-[var(--mint)]"
              : status === "error"
              ? "border-[var(--danger)]/50 bg-[var(--danger)]/10 text-[var(--danger)]"
              : status === "locating"
              ? "border-[var(--hivis)]/50 bg-[var(--hivis)]/10 text-[var(--hivis)]"
              : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--text-secondary)]"
          }`}
          role="status"
          aria-live="polite"
        >
          <p className="text-xs font-mono uppercase tracking-wider font-semibold">
            {status === "locating" && "📍 Locating…"}
            {status === "success" && "✓ Success"}
            {status === "error" && "✕ Failed"}
            {status === "idle" && "Ready to punch"}
          </p>
          <p className="text-xs font-mono mt-1 tnum">{message || "Press Clock In or Clock Out"}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handlePunch("in")}
            disabled={isClockingIn || isClockingOut}
            className="btn-surgical-mint rounded px-4 py-3 text-xs font-semibold uppercase tracking-wider min-h-[44px]"
          >
            {isClockingIn ? "Locating…" : "Clock In"}
          </button>
          <button
            onClick={() => handlePunch("out")}
            disabled={isClockingIn || isClockingOut}
            className="btn-surgical-danger rounded px-4 py-3 text-xs font-semibold uppercase tracking-wider min-h-[44px]"
          >
            {isClockingOut ? "Locating…" : "Clock Out"}
          </button>
        </div>

        {lastPunch && (
          <div className="card-subpanel p-3 text-xs font-mono text-center tnum text-[var(--text-secondary)]">
            Last: {lastPunch.geoPassed ? "✓" : "✕"} {new Date(lastPunch.ts).toLocaleString()}
            {lastPunch.durationSec !== undefined && (
              <> • Duration: {formatDuration(lastPunch.durationSec)}</>
            )}
          </div>
        )}

        {punchHistory.length > 0 && (
          <details className="text-xs font-mono text-[var(--fog)]">
            <summary className="cursor-pointer mb-2 uppercase tracking-wider hover:text-[var(--paper)]">Recent Punches ({punchHistory.length})</summary>
            <ul className="space-y-1.5 max-h-48 overflow-auto tnum">
              {punchHistory.slice(0, 10).map((p: { type: string; geoPassed: boolean; ts: number; durationSec?: number }) => (
                <li key={p.ts} className="flex justify-between gap-2 border-b border-[var(--line-subtle)] pb-1">
                  <span>
                    {p.type === "in" ? "● In" : "○ Out"} {new Date(p.ts).toLocaleTimeString()}
                    {p.geoPassed ? " ✓" : " ✕"}
                  </span>
                  {p.durationSec !== undefined && <span className="text-[var(--paper)]">{formatDuration(p.durationSec)}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </main>
  );
}