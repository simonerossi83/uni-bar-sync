CREATE TABLE public.app_rate_limits (
  scope text NOT NULL,
  identifier_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count int NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (scope, identifier_hash),
  CONSTRAINT app_rate_limits_scope_check CHECK (length(scope) BETWEEN 1 AND 64),
  CONSTRAINT app_rate_limits_identifier_hash_check CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT app_rate_limits_request_count_check CHECK (request_count > 0)
);

CREATE INDEX app_rate_limits_updated_at_idx ON public.app_rate_limits (updated_at);

ALTER TABLE public.app_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_rate_limits TO service_role;

CREATE FUNCTION public.consume_rate_limit(
  p_scope text,
  p_identifier_hash text,
  p_window_seconds int,
  p_max_requests int
)
RETURNS TABLE (allowed boolean, retry_after_seconds int)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  current_time timestamptz := clock_timestamp();
  window_duration interval;
  bucket_started_at timestamptz;
  bucket_count int;
BEGIN
  IF p_scope IS NULL OR length(p_scope) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'Ambito rate limit non valido';
  END IF;
  IF p_identifier_hash IS NULL OR p_identifier_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Identificativo rate limit non valido';
  END IF;
  IF p_window_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'Finestra rate limit non valida';
  END IF;
  IF p_max_requests NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Soglia rate limit non valida';
  END IF;

  window_duration := make_interval(secs => p_window_seconds);

  INSERT INTO public.app_rate_limits AS limits (
    scope, identifier_hash, window_started_at, request_count, updated_at
  )
  VALUES (p_scope, p_identifier_hash, current_time, 1, current_time)
  ON CONFLICT (scope, identifier_hash) DO UPDATE
  SET
    window_started_at = CASE
      WHEN limits.window_started_at <= current_time - window_duration THEN current_time
      ELSE limits.window_started_at
    END,
    request_count = CASE
      WHEN limits.window_started_at <= current_time - window_duration THEN 1
      ELSE limits.request_count + 1
    END,
    updated_at = current_time
  RETURNING window_started_at, request_count
  INTO bucket_started_at, bucket_count;

  allowed := bucket_count <= p_max_requests;
  retry_after_seconds := CASE
    WHEN allowed THEN 0
    ELSE GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (bucket_started_at + window_duration - current_time)))::int
    )
  END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, text, int, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, text, int, int)
  TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'uni-bar-clean-rate-limits',
  '23 3 * * *',
  $job$DELETE FROM public.app_rate_limits WHERE updated_at < now() - interval '2 days';$job$
);
