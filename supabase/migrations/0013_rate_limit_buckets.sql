-- 0013_rate_limit_buckets.sql — shared rate-limit buckets for /api/auth/session-bootstrap
--
-- The route's in-memory limiter only throttles per serverless instance. This
-- adds a Postgres-backed sliding window used when present; the route falls
-- back to the in-memory limiter if the function is missing (migration not
-- applied yet) — never fail open on the master break-glass path.
--
-- Apply after 0012. Purely additive. Idempotent.

create table if not exists public.jpay_rate_limits (
  bucket       text primary key,
  window_start bigint not null,
  hits         integer not null
);

alter table public.jpay_rate_limits enable row level security;

create or replace function public.jpay_rate_limit_hit(
  p_bucket text,
  p_window_ms bigint,
  p_limit integer
) returns boolean
language plpgsql
as $$
declare
  v_now  bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_hits integer;
begin
  insert into public.jpay_rate_limits (bucket, window_start, hits)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update set
    window_start = case when public.jpay_rate_limits.window_start + p_window_ms < v_now
                        then v_now else public.jpay_rate_limits.window_start end,
    hits         = case when public.jpay_rate_limits.window_start + p_window_ms < v_now
                        then 1 else public.jpay_rate_limits.hits + 1 end
  returning hits into v_hits;
  return v_hits > p_limit;
end;
$$;
