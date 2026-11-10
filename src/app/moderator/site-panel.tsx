"use client";

import { useState } from "react";
import { useMutation } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { ConsoleWindow } from "@/components/console/window";
import { SiteMapPicker } from "../site-map-picker";
import { errMsg } from "@/lib/errors";
import { useOrg } from "./org-context";

/* ─────────────────────────── Create site panel ─────────────────────────── */

export function SitePanel() {
  const createSite = useMutation(api.sites.createSite);
  const { orgId } = useOrg();
  const [form, setForm] = useState({ name: "", lat: "", lng: "", radius: "150", tz: "Africa/Johannesburg" });
  const coord = (v: string): number | null => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  };
  const latNum = coord(form.lat);
  const lngNum = coord(form.lng);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <ConsoleWindow
      title="Create site"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-2 p-2 md:flex-row md:p-3"
      aside={<span className="text-xs text-[var(--fog)]">{orgId ? "inside selected org" : "create an org first"}</span>}
    >
      <div className="flex min-h-0 flex-none flex-col md:w-[46%] md:flex-none">
        <SiteMapPicker lat={latNum} lng={lngNum} onPick={(a, b) => setForm({ ...form, lat: String(a), lng: String(b) })} />
      </div>
      <div className="grid flex-none grid-cols-2 content-start gap-1.5 md:min-h-0 md:flex-1 md:gap-2">
        <label className="col-span-2 flex flex-col gap-0.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name"
            className="input-surgical px-3 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Latitude</span>
          <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="Latitude" inputMode="decimal"
            className="input-surgical px-3 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Longitude</span>
          <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="Longitude" inputMode="decimal"
            className="input-surgical px-3 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Radius m</span>
          <input value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} placeholder="Radius m"
            inputMode="numeric" className="input-surgical px-3 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Timezone</span>
          <input value={form.tz} onChange={(e) => setForm({ ...form, tz: e.target.value })} placeholder="IANA timezone"
            className="input-surgical px-3 py-1.5 text-sm" />
        </label>
        {!orgId && (
          <p className="col-span-2 flex-none text-xs text-[var(--hivis)]">
            Create or select an organisation above first — sites belong to an org.
          </p>
        )}
        <button
          data-loading={busy}
          aria-busy={busy}
          disabled={busy || !orgId}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              await createSite({
                name: form.name,
                latitude: Number(form.lat),
                longitude: Number(form.lng),
                geofenceRadiusMeters: Number(form.radius),
                timezone: form.tz,
                orgId: orgId as never,
              });
              setMsg(`Created ${form.name}`);
              setForm({ ...form, name: "", lat: "", lng: "" });
            } catch (e) {
              setMsg(errMsg(e));
            } finally {
              setBusy(false);
            }
          }}
          className="btn-surgical col-span-2 min-h-[44px] flex-none px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          <span className="btn-label">Create site</span>
          <span className="btn-spinner" aria-hidden="true" />
        </button>
        {msg && <p className="col-span-2 flex-none truncate text-xs text-[var(--fog)]">{msg}</p>}
      </div>
    </ConsoleWindow>
  );
}

