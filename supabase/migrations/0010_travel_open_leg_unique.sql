-- 0010_travel_open_leg_unique.sql — at most ONE open travel leg per user
--
-- B3 (2026-11-10): recordFix does read-then-insert; an outbox double-fire or
-- cross-device retry inside one round-trip opens two permanent legs and the
-- manager map picks an arbitrary one. Enforce one open leg per user at the DB.
--
-- Apply with or right after 0006 (travel_tracking) and 0009. Idempotent.
-- Existing duplicates: the newest open leg wins; older open duplicates are
-- closed (arrivedAt = the newest leg's departedAt) and flagged for review
-- rather than deleted — evidence is never discarded.

do $$
begin
  if exists (
    select 1
    from public."travelSegments"
    where "arrivedAt" is null
    group by "userId"
    having count(*) > 1
  ) then
    update public."travelSegments" t
       set "arrivedAt" = (
             select max(s."departedAt") from public."travelSegments" s
             where s."userId" = t."userId" and s."arrivedAt" is null
           ),
           "needsReview" = true,
           "reviewReason" = coalesce(t."reviewReason", 'duplicate_open_leg')
     where t."arrivedAt" is null
       and t."_creationTime" < (
             select max(s2."_creationTime") from public."travelSegments" s2
             where s2."userId" = t."userId" and s2."arrivedAt" is null
           );
  end if;
end $$;

create unique index if not exists travel_segments_one_open
  on public."travelSegments" ("userId")
  where "arrivedAt" is null;
