"use client";

import { useEffect, useRef, useState } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAction } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";

type Hit = { display_name: string; lat: string; lon: string };

export function SiteMapPicker({
  lat,
  lng,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const mapRef = useRef<LType.Map | null>(null);
  const markerRef = useRef<LType.Marker | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [L, setL] = useState<typeof LType | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocode = useAction(api.geocode.geocode);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (!cancelled) setL((mod.default ?? mod) as typeof LType);
    });
    return () => {
      cancelled = true;
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  useEffect(() => {
    if (!L || !containerRef.current || mapRef.current) return;
    const start: [number, number] = lat !== null && lng !== null ? [lat, lng] : [-26.2, 28.04];
    const map = L.map(containerRef.current).setView(start, lat !== null ? 16 : 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    map.on("click", (e: LType.LeafletMouseEvent) => {
      pickRef.current(e.latlng.lat, e.latlng.lng);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L]);

  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map) return;
    if (lat !== null && lng !== null) {
      map.setView([lat, lng], Math.max(map.getZoom(), 15));
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng]).addTo(map);
      }
    }
  }, [lat, lng, L]);

  function search(q: string) {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 3) {
      setHits([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await geocode({ query: q });
        setHits(data as Hit[]);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 600);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 md:gap-2">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search address…"
          className="input-surgical w-full px-3.5 py-2 text-sm"
        />
        {hits.length > 0 && (
          <ul className="card-surgical absolute z-[500] mt-1 w-full overflow-hidden shadow-xl">
            {hits.map((h) => (
              <li key={h.display_name} className="border-b border-[var(--line)]/50 last:border-0">
                <button
                  type="button"
                  onClick={() => {
                    pickRef.current(Number(h.lat), Number(h.lon));
                    setQuery(h.display_name.split(",").slice(0, 2).join(","));
                    setHits([]);
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs text-[var(--paper)] hover:bg-[var(--panel-elevated)] transition"
                >
                  {h.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {searching && <span className="absolute right-3.5 top-2.5 text-xs text-[var(--fog)]">…</span>}
      </div>
      <div ref={containerRef} className="h-32 w-full flex-none overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-2)] md:h-full md:min-h-0 md:flex-1" />
      <div className="flex flex-wrap items-center gap-2.5 text-xs">
        <button
          type="button"
          onClick={() =>
            navigator.geolocation?.getCurrentPosition((pos) =>
              pickRef.current(pos.coords.latitude, pos.coords.longitude)
            )
          }
          className="btn-surgical px-3 py-1.5 font-medium"
        >
          Use my location
        </button>
        {lat !== null && lng !== null && (
          <a
            href={`https://www.google.com/maps?q=${lat},${lng}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[var(--mint)] underline hover:brightness-110"
          >
            Verify in Google Maps ↗
          </a>
        )}
        <span className="tnum ml-auto font-mono text-[var(--fog)]">
          {lat !== null && lng !== null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "click the map"}
        </span>
      </div>
    </div>
  );
}
