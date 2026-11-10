-- 0012_manager_sites_archive.sql — manager grants leave an evidence trail
--
-- B7 (2026-11-10): demotion used to DELETE managerSites rows, erasing the
-- evidence of who granted live-GPS visibility on which sites. The column
-- lets demotion archive instead of delete; the runtime also writes a
-- systemEvents audit row for every grant/revoke/promote/demote.
--
-- Apply after 0011. Purely additive. Idempotent.

alter table public."managerSites"
  add column if not exists "archivedAt" bigint;
