CREATE OR REPLACE FUNCTION public.consume_rate_limit(
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
  request_timestamp timestamptz := clock_timestamp();
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
  VALUES (p_scope, p_identifier_hash, request_timestamp, 1, request_timestamp)
  ON CONFLICT (scope, identifier_hash) DO UPDATE
  SET
    window_started_at = CASE
      WHEN limits.window_started_at <= request_timestamp - window_duration
        THEN request_timestamp
      ELSE limits.window_started_at
    END,
    request_count = CASE
      WHEN limits.window_started_at <= request_timestamp - window_duration THEN 1
      ELSE limits.request_count + 1
    END,
    updated_at = request_timestamp
  RETURNING window_started_at, request_count
  INTO bucket_started_at, bucket_count;

  allowed := bucket_count <= p_max_requests;
  retry_after_seconds := CASE
    WHEN allowed THEN 0
    ELSE GREATEST(
      1,
      CEIL(
        EXTRACT(EPOCH FROM (bucket_started_at + window_duration - request_timestamp))
      )::int
    )
  END;
  RETURN NEXT;
END;
$$;
