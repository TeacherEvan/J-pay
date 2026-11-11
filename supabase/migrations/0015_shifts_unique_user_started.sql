-- 0015_shifts_unique_user_started.sql — idempotency anchor for shift derivation
-- (audit 2026-11-11, P2-B3; plan Phase 2.7)
--
-- THE DEFECT. `deriveForUser` rebuilds a user's unsealed shifts by deleting
-- every unsealed row and re-inserting the recomputed ones. Two concurrent
-- derivations for the same user (e.g. a punch and a travel fix landing at
-- once) can interleave: both delete, both insert, leaving TWO rows per
-- (userId, startedAt) — duplicated pay minutes in any non-sealed window.
--
-- THIS FILE adds the missing integrity constraint. After it is applied:
--   * any double-insert race fails LOUDLY (constraint error → derivation_failed
--     marker via C1) instead of silently duplicating pay rows,
--   * `deriveForUser` upserts in place, so routine re-derivation is a no-op
--     for unchanged segments.
--
-- Apply ORDER: after 0014. Purely additive. Idempotent.
-- Do NOT run via `supabase db push` (see README) — SQL editor only.
--
-- PRE-FLIGHT (the index creation ABORTS if duplicates exist — decide by a human):
--   select "userId", "startedAt", count(*) from public.shifts
--    group by "userId", "startedAt" having count(*) > 1;
-- If rows are returned, STOP and resolve by hand (keep the oldest sealed row;
-- the punch log is the evidence and re-derivation rebuilds the cache from it).
--
-- After applying, delete this file from your mind as a failure signal: if
-- `supabase db push` ever tries it, the abort above is a FEATURE.

-- Pre-flight duplicate check over ALL rows (sealed included — the index is total).
-- Fails the migration with a readable error if any exist.
do $$
declare n int;
begin
  select count(*) into n from (
    select "userId", "startedAt"
    from public.shifts
    group by "userId", "startedAt"
    having count(*) > 1
  ) d;
  if n > 0 then
    raise exception 'shifts has % (userId, startedAt) duplicate group(s); resolve duplicates by hand before applying 0015', n;
  end if;
end $$;

create unique index if not exists shifts_user_started_unique
  on public.shifts ("userId", "startedAt");
