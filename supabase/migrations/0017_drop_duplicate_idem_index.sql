-- 0017_drop_duplicate_idem_index.sql — drop the redundant logs idempotency index (audit 2026-11-11, P2-F16)
--
-- THE DEFECT. `public.logs` carries TWO identical indexes on ("userId", "idempotencyKey"):
--   * logs_user_idem_idx   — created in 0001_init.sql (non-unique, redundant),
--   * logs_user_idem_uniq  — created in 0002_logs_idempotency_unique.sql (UNIQUE — the real constraint).
-- The plain index is pure write overhead and query-planner noise; it enforces nothing.
--
-- THIS FILE (draft — DO NOT apply blindly; owner applies via the SQL editor):
--   drops ONLY logs_user_idem_idx, and ONLY after a guarded pre-flight proves the
--   surviving index (logs_user_idem_uniq) exists and is unique. If the pre-flight
--   fails, the migration ABORTS with a readable error instead of dropping the only
--   protection the dedupe path has. No data operations; purely structural.
--
-- Apply ORDER: after 0016. Idempotent (drop index if exists).
-- Do NOT run via `supabase db push` — SQL editor only.
--
-- PRE-FLIGHT (standalone, run first if you want to inspect by hand):
--   select indexrelid::regclass::text as index_name, i.indisunique
--     from pg_index i
--     join pg_class c on c.oid = i.indexrelid
--    where c.relname in ('logs_user_idem_idx', 'logs_user_idem_uniq');
--   -- expect: logs_user_idem_uniq | t   (and logs_user_idem_idx | f, if still present)

do $$
declare
  v_unique boolean;
begin
  select i.indisunique
    into v_unique
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'logs_user_idem_uniq';

  if v_unique is null then
    raise exception '0017 aborted: unique index public.logs_user_idem_uniq is MISSING — refusing to drop logs_user_idem_idx (it may be the only (userId, idempotencyKey) index left). Re-create logs_user_idem_uniq first, then re-run.';
  end if;

  if v_unique is not true then
    raise exception '0017 aborted: public.logs_user_idem_uniq exists but indisunique = false — refusing to drop logs_user_idem_idx. Inspect pg_index by hand.';
  end if;
end $$;

drop index if exists public.logs_user_idem_idx;

notify pgrst, 'reload schema';
