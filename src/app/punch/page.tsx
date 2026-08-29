"use client";

export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { errMsg } from "@/lib/errors";

type PunchResult = {
  punchId: string;
  geoPassed: boolean;
  durationSec?: number;
  ts: number;
} | null;

type Site = {
  _id: string;
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
        <div className="text-center text-sm animate-pulse">
          <div className="h-8 bg-neutral-800 w-48 mx-auto rounded mb-4" />
          <div className="h-4 bg-neutral-800 w-64 mx-auto rounded" />
        </div>
      </main>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <main className="min-h-dvh grid place-items-center p-6">
        <div className="text-center text-sm">
          <p className="text-neutral-400 mb-4">Please sign in first.</p>
          <a href="/login" className="text-primary-400 hover:underline text-sm">
            Go to login
          </a>
        </div>
      </main>
    );
  }

  if (!site) {
    return (
      <main className="min-h-dvh grid place-items-center p-6">
        <div className="text-center text-sm">
          <h1 className="text-xl font-bold mb-4">Punch Clock</h1>
          <div className="text-red-400 bg-red-900/30 border border-red-800 rounded p-4 max-w-sm mx-auto">
            <p className="font-medium mb-2">No Site Assigned</p>
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
        setMessage(`✗ Outside geofence (${Math.round(result.distance || 0)}m > ${site.geofenceRadiusMeters}m radius)`);
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
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Punch Clock</h1>
          <p className="text-neutral-400 text-sm">{site.name}</p>
          <p className="text-xs text-neutral-500 mt-1">
            Radius: {(site.geofenceRadiusMeters / 1000).toFixed(1)} km
          </p>
        </div>

        <div
          className={`rounded-lg border p-4 text-center transition-colors ${
            status === "success"
              ? "border-green-700 bg-green-900/20"
              : status === "error"
              ? "border-red-700 bg-red-900/20"
              : status === "locating"
              ? "border-yellow-700 bg-yellow-900/20"
              : "border-neutral-700"
          }`}
          role="status"
          aria-live="polite"
        >
          <p className="text-sm font-medium">
            {status === "locating" && "📍 Locating…"}
            {status === "success" && "✅ Success"}
            {status === "error" && "❌ Failed"}
            {status === "idle" && "Ready to punch"}
          </p>
          <p className="text-sm mt-1">{message || "Press Clock In or Clock Out"}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handlePunch("in")}
            disabled={isClockingIn || isClockingOut}
            className="rounded bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-neutral-950"
          >
            {isClockingIn ? "Locating…" : "Clock In"}
          </button>
          <button
            onClick={() => handlePunch("out")}
            disabled={isClockingIn || isClockingOut}
            className="rounded bg-red-600 px-4 py-3 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-neutral-950"
          >
            {isClockingOut ? "Locating…" : "Clock Out"}
          </button>
        </div>

        {lastPunch && (
          <div className="rounded border border-neutral-700 bg-neutral-900/50 p-3 text-xs text-center">
            Last: {lastPunch.geoPassed ? "✅" : "❌"} {new Date(lastPunch.ts).toLocaleString()}
            {lastPunch.durationSec !== undefined && (
              <> • Duration: {formatDuration(lastPunch.durationSec)}</>
            )}
          </div>
        )}

        {punchHistory.length > 0 && (
          <details className="text-xs text-neutral-400">
            <summary className="cursor-pointer mb-2">Recent Punches ({punchHistory.length})</summary>
            <ul className="space-y-1 max-h-48 overflow-auto">
              {punchHistory.slice(0, 10).map((p: { type: string; geoPassed: boolean; ts: number; durationSec?: number }) => (
                <li key={p.ts} className="flex justify-between gap-2">
                  <span>
                    {p.type === "in" ? "🟢 In" : "🔴 Out"} {new Date(p.ts).toLocaleTimeString()}
                    {p.geoPassed ? " ✅" : " ❌"}
                  </span>
                  {p.durationSec !== undefined && <span>{formatDuration(p.durationSec)}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </main>
  );
}