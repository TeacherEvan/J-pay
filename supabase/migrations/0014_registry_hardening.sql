-- 0014_registry_hardening.sql — close the anon-registry exposure (audit 2026-11-11, P0-F1)
--
-- THE DEFECT. Two compounding facts make `public.jpay_id_registry` readable by the
-- unauthenticated browser even though every base table is RLS default-deny:
--   1. 0001_init.sql:317-318 revoked `anon, authenticated` off the tables that existed AT
--      THAT MOMENT. It never set ALTER DEFAULT PRIVILEGES, and Supabase's
--      pg_default_acl grants `arwdDxtm` to anon+authenticated for every object created
--      afterwards. Every table created since is only saved by RLS (0 policies).
--   2. 0009 dropped and recreated the view WITHOUT `security_invoker = on`, so it runs as
--      its owner (postgres) and bypasses the base tables' RLS entirely. Views cannot have
--      RLS of their own, so the anon+authenticated grants it inherited from the default
--      ACL made the whole registry — 48 rows: users, organisations, sites, UUID ids of
--      auth.users — publicly enumerable.
--
-- THIS FILE:
--   a) revokes all privileges on the view from the browser roles,
--   b) sets security_invoker = on so the view evaluates the base tables' RLS AS THE CALLER
--      (anon then sees 0 rows even if a grant is ever restored),
--   c) stops the bleeding for EVERY object created after this point — no more
--      default anon/authenticated grants in this schema,
--   d) reloads the PostgREST schema cache.
--
-- Apply ORDER: after 0013 (before any future object is created). Purely additive; idempotent.
-- Do NOT fold this into a past migration; do NOT drop and recreate the view (that would
-- re-apply the default ACL the revoke exists to kill, and would break the text-typed id).
--
-- Verify as the anon role afterwards:
--   select count(*) from public.jpay_id_registry;   -- expect ERROR or 0 rows, never 48
-- Advisor `security_definer_view` must return no rows for this view.

revoke all on public.jpay_id_registry from anon, authenticated;

alter view public.jpay_id_registry set (security_invoker = on);

alter default privileges in schema public
  revoke all on tables    from anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

notify pgrst, 'reload schema';
