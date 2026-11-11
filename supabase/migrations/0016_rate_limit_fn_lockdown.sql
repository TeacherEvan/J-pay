-- 0016_rate_limit_fn_lockdown.sql — lock down public.jpay_rate_limit_hit (audit 2026-11-11, P2-F11)
--
-- THE DEFECT. `public.jpay_rate_limit_hit(p_bucket text, p_window_ms bigint, p_limit integer)`
-- (created in 0013_rate_limit_buckets.sql) is a SECURITY-RELEVANT counter: it is the
-- Postgres-backed rate limiter for /api/auth/session-bootstrap. Two problems:
--   1. EXECUTE is granted to PUBLIC (the default for functions), so anon / authenticated
--      browser roles can call it directly to probe bucket state or burn the counter.
--   2. The function has no `SET search_path`, so a role with CREATE on some schema on the
--      search_path could shadow the objects it references (public.jpay_rate_limits).
--
-- THIS FILE (draft — DO NOT apply blindly; owner applies via the SQL editor):
--   a) revokes EXECUTE from PUBLIC, anon and authenticated,
--   b) grants EXECUTE to service_role only (the route uses the service-role key),
--   c) pins `search_path = public, pg_catalog` on the function.
--
-- Apply ORDER: after 0015. Purely additive; idempotent (re-running is a no-op).
-- Do NOT run via `supabase db push` — SQL editor only.
--
-- Exact argument signature being locked down (from 0013):
--   public.jpay_rate_limit_hit(p_bucket text, p_window_ms bigint, p_limit integer) returns boolean
--
-- SELF-CHECK (run after applying; every row must report the expected value):
--   -- 1) PUBLIC / anon / authenticated must NOT hold EXECUTE on the function:
--   select p.proname,
--          coalesce(p.proacl::text, '(default: PUBLIC execute)') as proacl,
--          has_function_privilege('anon',          'public.jpay_rate_limit_hit(text,bigint,integer)', 'execute') as anon_exec,
--          has_function_privilege('authenticated', 'public.jpay_rate_limit_hit(text,bigint,integer)', 'execute') as authenticated_exec,
--          has_function_privilege('service_role',  'public.jpay_rate_limit_hit(text,bigint,integer)', 'execute') as service_role_exec
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'jpay_rate_limit_hit';
--   -- expect: anon_exec = false, authenticated_exec = false, service_role_exec = true
--
--   -- 2) No default ACL may re-grant EXECUTE on future functions to PUBLIC/anon/authenticated:
--   select pg_get_userbyid(d.defaclrole) as role, d.defaclobjtype,
--          unnest(d.defaclacl) as acl_entry
--     from pg_default_acl d
--     join pg_namespace n on n.oid = d.defaclnamespace
--    where n.nspname = 'public' and d.defaclobjtype = 'f';
--   -- expect: no row whose acl_entry grants EXECUTE to PUBLIC ('' / '=X'), anon or authenticated
--   -- (0014 already revokes default EXECUTE from anon/authenticated; this confirms it held.)

revoke execute on function public.jpay_rate_limit_hit(p_bucket text, p_window_ms bigint, p_limit integer)
  from public, anon, authenticated;

grant execute on function public.jpay_rate_limit_hit(p_bucket text, p_window_ms bigint, p_limit integer)
  to service_role;

alter function public.jpay_rate_limit_hit(p_bucket text, p_window_ms bigint, p_limit integer)
  set search_path = public, pg_catalog;

notify pgrst, 'reload schema';
