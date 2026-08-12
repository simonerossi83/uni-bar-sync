CREATE INDEX orders_preparing_ready_at_idx
  ON public.orders (estimated_ready_at)
  WHERE status = 'preparing' AND archived_at IS NULL;

-- Keep already-deployed clients working while the idempotent client rolls out.
CREATE FUNCTION public.create_bar_order(p_lines jsonb, p_note text DEFAULT NULL)
RETURNS TABLE (
  id uuid, order_number int, status text, note text, total numeric,
  created_at timestamptz, updated_at timestamptz,
  estimated_ready_at timestamptz, archived_at timestamptz
)
LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$
  SELECT *
  FROM public.create_bar_order(p_lines, p_note, gen_random_uuid());
$$;

REVOKE ALL ON FUNCTION public.create_bar_order(jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bar_order(jsonb, text)
  TO service_role;
