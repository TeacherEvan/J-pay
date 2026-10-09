// Barrel: re-exports the demo module so Convex's generated api resolves
// `internal.demo` / `api.demo` correctly. The implementation lives in
// ./demo/index.ts; this file exists because Convex codegen expects
// `demo.js` (a top-level module) but the source was reorganised into a
// folder. Without this barrel, cron references like
// internal.demo.purgeStaleReviewers fail to resolve at deploy time.
export * from './demo/index';
export * from './demo/seed';
export * from './demo/scope';
export * from './demo/sites';
