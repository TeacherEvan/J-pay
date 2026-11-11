"use client";

import { useRef } from "react";
import { useAction } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errMsg } from "@/lib/errors";
import { serverNow } from "@/lib/server-clock";
import { LABEL } from "./types";
import type { Status, CardSite } from "./types";


export function PersonaSubmit({
  status,
  siteId,
  sites,
  sideMinutes,
  label,
  busy,
  setBusy,
  setMessage,
}: {
  status: Status;
  siteId: Id<"sites"> | "";
  sites: CardSite[];
  sideMinutes: number;
  label: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMessage: (m: string | null) => void;
}) {
  const checkIn = useAction(api.demo.checkInAsPersona);
  const inflight = useRef(false);

  async function doCheckIn() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setMessage(null);
    const chosen = sites.find((s) => s._id === siteId) ?? sites[0];
    if (!chosen) {
      setMessage("No sites available for this persona.");
      inflight.current = false;
      setBusy(false);
      return;
    }
    try {
      const result = await checkIn({
        siteId: chosen._id,
        clientReportedTime: serverNow(),
        status,
        latitude: chosen.latitude,
        longitude: chosen.longitude,
        accuracyMeters: 18,
        sideMissionDurationMinutes:
          status === "quick side mission" ? (sideMinutes as 15 | 30 | 45 | 60 | 120) : undefined,
        deviceToken: "demo-device-token",
        idempotencyKey: crypto.randomUUID(),
        deviceMetadata: "demo-reviewer-checkin",
      });
      setMessage(
        result.duplicate
          ? "Already logged — duplicate ignored."
          : `Logged: ${LABEL[status]} at ${chosen.name}.`
      );
    } catch (e) {
      setMessage(errMsg(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-testid="demo-checkin-button"
      data-loading={busy}
      aria-busy={busy}
      onClick={() => void doCheckIn()}
      disabled={busy}
      className={`btn-surgical h-14 rounded-xl text-base font-bold transition disabled:opacity-50 ${
        status === "day finish"
          ? "btn-surgical-hivis"
          : "btn-surgical-mint"
      }`}
    >
      <span className="btn-label">{`${label} (as persona)`}</span>
      <span className="btn-spinner" aria-hidden="true" />
    </button>
  );
}
