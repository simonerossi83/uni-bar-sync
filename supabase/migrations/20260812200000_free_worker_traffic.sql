CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.orders
  ADD COLUMN customer_access_hash text;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_customer_access_hash_check
  CHECK (
    customer_access_hash IS NULL
    OR customer_access_hash ~ '^[0-9a-f]{64}$'
  );

CREATE FUNCTION public.create_bar_order_secured(
  p_lines jsonb,
  p_note text,
  p_client_request_id uuid,
  p_customer_access_hash text
)
RETURNS TABLE (
  id uuid, order_number int, status text, note text, total numeric,
  created_at timestamptz, updated_at timestamptz,
  estimated_ready_at timestamptz, archived_at timestamptz
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  created_order record;
  secured_order_id uuid;
BEGIN
  IF p_customer_access_hash IS NULL
    OR p_customer_access_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Token ordine non valido';
  END IF;

  SELECT * INTO created_order
  FROM public.create_bar_order(p_lines, p_note, p_client_request_id);

  UPDATE public.orders AS orders
  SET customer_access_hash = p_customer_access_hash
  WHERE orders.id = created_order.id
    AND (
      orders.customer_access_hash IS NULL
      OR orders.customer_access_hash = p_customer_access_hash
    )
  RETURNING orders.id INTO secured_order_id;

  IF secured_order_id IS NULL THEN
    RAISE EXCEPTION 'Token ordine non coerente';
  END IF;

  RETURN QUERY SELECT
    created_order.id,
    created_order.order_number,
    created_order.status,
    created_order.note,
    created_order.total,
    created_order.created_at,
    created_order.updated_at,
    created_order.estimated_ready_at,
    created_order.archived_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bar_order_secured(jsonb, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bar_order_secured(jsonb, text, uuid, text)
  TO service_role;

CREATE FUNCTION public.get_customer_order_status(
  p_order_id uuid,
  p_access_token text
)
RETURNS TABLE (
  id uuid,
  status text,
  updated_at timestamptz,
  estimated_ready_at timestamptz,
  archived_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    orders.id,
    orders.status,
    orders.updated_at,
    orders.estimated_ready_at,
    orders.archived_at
  FROM public.orders AS orders
  WHERE orders.id = p_order_id
    AND length(p_access_token) = 64
    AND orders.customer_access_hash = encode(digest(p_access_token, 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION public.get_customer_order_status(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_order_status(uuid, text)
  TO anon, authenticated, service_role;
