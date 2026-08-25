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
  // When @serwist/next ships Turbopack support, revisit and add a
  // `turbopack: {}` config here (or remove this comment block) — see
  // docs/plans/2026-08-25-next-16-upgrade.md §M2 + TRD Open Question #2.
};

export default withSerwist(nextConfig);
