-- 0002_logs_idempotency_unique.sql
-- J-Pay — logs idempotency guard (audit 2026-11-10, P1-2 hardening).
--
-- The shift engine dedupes by (userId, idempotencyKey), but nothing in the
-- database prevents two concurrent inserts of the same key (double-tap punch,
-- outbox retry racing a live punch). The engine flags duplicate_key_conflict
-- only AFTER both rows exist — this index prevents the second write.
--
-- SAFETY: applying this fails if duplicates already exist. Before applying,
-- run this diagnostic and resolve any rows it returns (keep the earliest
-- _creationTime per key, delete the rest after review):
--   select "userId", "idempotencyKey", count(*)
--   from public.logs group by 1, 2 having count(*) > 1;
--
-- This migration is intentionally NOT applied to production from an agent
-- session. Apply via the Supabase dashboard / CLI after review.

create unique index if not exists logs_user_idem_uniq
  on public.logs ("userId", "idempotencyKey");
