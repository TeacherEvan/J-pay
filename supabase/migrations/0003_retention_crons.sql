-- 0003_retention_crons.sql — daily retention jobs for the Supabase-authoritative deployment
-- (audit 2026-11-10, P1-4; supabase/migrations/0001_init.sql had no cron mechanism, and
-- convex/crons.ts is never executed here — the retention tier was dead code in prod).
--
-- NOT APPLIED by any agent session. Apply after review via the dashboard or
--   supabase db push
--
-- Prerequisites: enable extensions in the dashboard (Database → Extensions):
--   pg_cron, pg_net
--
-- Before applying:
--   1. Replace __SITE_URL__ with the canonical site (e.g. https://j-pay.vercel.app)
--   2. Replace __CRON_SECRET__ with a random secret (openssl rand -hex 32)
--   3. Set CRON_SECRET in Vercel env to the same value (Project → Settings → Environment Variables,
--      Production), and redeploy
--   4. Apply this file, then verify:
--        select jobname, schedule, command from cron.job;
--        select * from cron.job_run_details order by start_time desc limit 4;
--   5. Dry-run each job once by hand against the deployed route and confirm 200:
--        curl -X POST -H "Authorization: Bearer <secret>" "<SITE_URL>/api/internal/cron?job=purge-expired-coordinates"
--
-- If jobs fail with 401: the Vercel CRON_SECRET env does not match (or is missing) — redeploy after setting it.
-- If jobs fail with 500: read the function logs; the route returns CRON_FAILED and logs the cause.

select cron.schedule('purge-expired-coordinates', '0 2 * * *',
  $$select net.http_post(url := '__SITE_URL__/api/internal/cron?job=purge-expired-coordinates',
                         headers := '{"Authorization":"Bearer __CRON_SECRET__"}'::jsonb)$$);

select cron.schedule('purge-stale-demo-reviewers', '0 3 * * *',
  $$select net.http_post(url := '__SITE_URL__/api/internal/cron?job=purge-stale-demo-reviewers',
                         headers := '{"Authorization":"Bearer __CRON_SECRET__"}'::jsonb)$$);

select cron.schedule('archive-stale-master-temps', '0 4 * * *',
  $$select net.http_post(url := '__SITE_URL__/api/internal/cron?job=archive-stale-master-temps',
                         headers := '{"Authorization":"Bearer __CRON_SECRET__"}'::jsonb)$$);

select cron.schedule('purge-expired-messages', '0 5 * * *',
  $$select net.http_post(url := '__SITE_URL__/api/internal/cron?job=purge-expired-messages',
                         headers := '{"Authorization":"Bearer __CRON_SECRET__"}'::jsonb)$$);
