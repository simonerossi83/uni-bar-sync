-- Kitchen credentials and raw session tokens never enter this table.
CREATE TABLE public.kitchen_sessions (
  session_hash text PRIMARY KEY CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  credential_version text NOT NULL CHECK (credential_version ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT kitchen_session_expiry CHECK (expires_at > created_at)
);
CREATE INDEX kitchen_sessions_expires_at_idx ON public.kitchen_sessions(expires_at);
ALTER TABLE public.kitchen_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitchen_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kitchen_sessions TO service_role;

SELECT cron.schedule(
  'uni-bar-clean-kitchen-sessions',
  '41 3 * * *',
  $job$DELETE FROM public.kitchen_sessions WHERE expires_at < now() - interval '1 day';$job$
);
