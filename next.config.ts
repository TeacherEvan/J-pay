import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig: import("next").NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: import.meta.dirname,
  // D2 (TRD j-pay.md R30) decision — stay on webpack for the production build.
  // Next 16.3.2 enables Turbopack by default; we explicitly opt out of it
  // here because @serwist/next 10.0.0-preview.14 (and its @serwist/webpack-plugin
  // dependency) does not yet support Turbopack SW generation
  // (https://github.com/serwist/serwist/issues/54). The `next build` script
  // in package.json passes `--webpack` for the same reason.
  //
  // Dev mode (`npm run dev` → scripts/dev-strict.mjs → `npx next dev`) also
  // passes `--webpack` so dev and prod stay aligned. The empty
  // `turbopack: {}` below silences Next 16's "you have a webpack config but
  // Turbopack is the default" error on commands that don't take the flag
  // (e.g. `npx next info`).
  //
  // When @serwist/next ships Turbopack support, remove `turbopack: {}` and
  // the dev/build --webpack flags, and add real Turbopack config — see
  // docs/plans/2026-08-25-next-16-upgrade.md §M2 + TRD Open Question #2.
  // Same-origin + the two external origins the app actually talks to:
  //   connect-src — Supabase (REST + Realtime websocket)
  //   img-src     — OpenStreetMap tiles (Leaflet in the crew map / site picker)
  // script-src/style-src carry 'unsafe-inline' because Next inline-hydrates and
  // Leaflet positions via inline styles; tightening those needs nonces — future work.
  const cspReportOnly = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://tile.openstreetmap.org",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  turbopack: {},
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Report-Only on purpose: collect violations before enforcing.
          { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
