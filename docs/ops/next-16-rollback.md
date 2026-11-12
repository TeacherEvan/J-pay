# Next 16 rollback runbook

If the Next 16 upgrade ships a regression that the canary didn't catch, this is the 30-second rollback path.

## Symptoms (any one of these is enough to consider rolling back)
- Vercel prod returns 500s on `/` or `/moderator`
- The service worker fails to register (visible in DevTools → Application → Service Workers)
- The e2e walkthrough goes red on `main`
- A user reports a regression in the issue tracker

## Rollback steps (Vercel dashboard — fastest)
1. Open https://vercel.com/teacher-evans-projects/j-pay/deployments
2. Find the most recent `Ready` deployment BEFORE the Next 16 merge. Look for a deployment labeled "Next 15.3" or check the deployment timestamp against the merge commit (`git log --grep="Next 16.3.2"`).
3. Click `⋯` → "Promote to Production".
4. The alias `j-pay.vercel.app` now serves the previous deployment.

This is atomic on Vercel's edge — no rebuild, no DNS, no deploy hook.

## Code rollback (if the Vercel dashboard is unavailable)
1. Identify the merge commit: `git log --grep="Next 16.3.2" --oneline`
2. Revert the entire upgrade series as a single revert commit:
   ```bash
   git revert -m 1 <merge-commit-of-the-Next-16-PR>
   ```
   If the upgrade was a series of direct commits (no merge commit), revert them in reverse chronological order with `git revert <hash>` for each.
3. `git push` to `main` (owner action — the agent MUST NOT push).
4. Vercel auto-deploys the revert; the new deployment becomes the alias once it goes `Ready`.

## Service worker note
Rolling back the code alone will NOT clear the user's browser-cached `sw.js` from Next 16. Users who already registered the new SW will keep it until they:
- Reload the page with DevTools → Application → Service Workers → "Unregister" checked, OR
- Wait for the SW to expire (typically 24h unless the SW has a `skipWaiting()` handler — this one does not), OR
- Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).

For an instant user-side fix, the rollback code can ship a `public/sw.js` that calls `self.skipWaiting()` and `self.clients.claim()` on activate to force the old behavior. If the rollback is purely a Next 16.3.2 compatibility issue (not a SW behavior change), the cached SW is harmless and the page will work fine once the new code is deployed.

## Post-rollback
- Open an issue with the regression details (logs, screenshots, reproduction steps).
- Add a TRD row: `D2-rollback — Next 16 regression, rolled back to Next 15.3, see issue #X`.
- Schedule a follow-up plan to re-attempt the upgrade after the regression is fixed. Common culprits to investigate: SW race during `next build` (Serwist 10 preview is still preview), a Next 16 RSC streaming change that broke a route, or a React 19.1 behavior change.
- If the regression is in Serwist 10 specifically, consider pinning back to `@serwist/next@9.5.12` (which still satisfies Next 16's `>=14.0.0` peer) and reopening Open Question #11 (Turbopack adoption).

## What's NOT in this runbook
- Rolling back the `next` version only (e.g. `npm install next@^15.3.0`) without also reverting the Serwist 10 + glob override changes — that combination may not be a clean build. Revert the entire series.
- Vercel CLI rollback via `vercel rollback` — works the same as the dashboard Promote-to-Production step but is harder to discover for the owner. Prefer the dashboard.
