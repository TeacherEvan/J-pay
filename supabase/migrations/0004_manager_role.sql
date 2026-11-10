-- 0004_manager_role.sql — manager role (owner 2026-11-10)
--
-- Adds 'manager' to the users.role check constraint. A manager is an existing
-- user (same login/credentials — promotion never creates accounts): a field
-- employee with a management title. Manager scope is enforced in application
-- code (convex/access.ts + convex/manager.ts): managers see only the crews
-- assigned to the sites in their managerSites rows (added in 0005).
--
-- NOT APPLIED by any agent session. Apply via the Supabase dashboard / CLI.
-- After applying, moderators can promote employees to manager from /moderator.
-- Safe to apply before 0005: existing rows are untouched and unaffected.

alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check ("role" in ('moderator', 'employee', 'manager'));
