-- Migration 0020: Add index on logs(userId, clientReportedTime) for derivation horizon pushdown
-- This enables pushing the clientReportedTime >= horizonCutoff constraint into the index
-- instead of using a post-wire JS .filter() predicate.

-- The index supports the shift derivation query that fetches logs within a work-time
-- horizon (based on the latest sealed shift's startedAt). Previously this used
-- by_user_time index (userId + _creationTime ordering) + .filter() on clientReportedTime.
-- With this index, the range constraint pushes into PostgREST SQL.

CREATE INDEX IF NOT EXISTS logs_user_client_reported_time_idx
ON public.logs ("userId", "clientReportedTime");

-- Update the registry view to reflect the new index structure
-- (jpay_id_registry is maintained by triggers, no change needed for indexes)