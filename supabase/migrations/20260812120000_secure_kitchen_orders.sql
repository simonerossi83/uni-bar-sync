ALTER TABLE public.orders
  ADD COLUMN estimated_ready_at timestamptz,
  ADD COLUMN archived_at timestamptz;

UPDATE public.orders
SET estimated_ready_at = now() + interval '10 seconds'
WHERE status = 'preparing' AND estimated_ready_at IS NULL;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('received', 'preparing', 'ready', 'picked_up'));

CREATE INDEX orders_active_status_idx ON public.orders (status, order_number)
  WHERE archived_at IS NULL;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident('menu updatable by all') || ' ON public.menu_items';
  EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident('orders readable by all') || ' ON public.orders';
  EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident('orders insertable by all') || ' ON public.orders';
  EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident('orders updatable by all') || ' ON public.orders';
  EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident('order items readable by all') || ' ON public.order_items';
  EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident('order items insertable by all') || ' ON public.order_items';
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.menu_items FROM anon, authenticated;
GRANT SELECT ON public.menu_items TO anon, authenticated;
REVOKE ALL ON public.orders FROM anon, authenticated;
REVOKE USAGE, SELECT ON SEQUENCE public.order_number_seq FROM anon, authenticated;
REVOKE ALL ON public.order_items FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_bar_order(p_lines jsonb, p_note text DEFAULT NULL)
RETURNS TABLE (
  id uuid, order_number int, status text, note text, total numeric,
  created_at timestamptz, updated_at timestamptz,
  estimated_ready_at timestamptz, archived_at timestamptz
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  new_order public.orders%ROWTYPE;
  calculated_total numeric(8,2);
  requested_count int;
  valid_count int;
BEGIN
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0
    OR jsonb_array_length(p_lines) > 50 THEN
    RAISE EXCEPTION 'Ordine non valido';
  END IF;

  WITH requested AS (
    SELECT (line->>'menu_item_id')::uuid AS menu_item_id,
      SUM((line->>'quantity')::int)::int AS quantity
    FROM jsonb_array_elements(p_lines) AS line
    GROUP BY (line->>'menu_item_id')::uuid
  ), validated AS (
    SELECT requested.menu_item_id, requested.quantity, menu_items.price
    FROM requested JOIN public.menu_items ON menu_items.id = requested.menu_item_id
    WHERE menu_items.available AND requested.quantity BETWEEN 1 AND 20
  )
  SELECT (SELECT count(*) FROM requested), count(*),
    COALESCE(sum(validated.price * validated.quantity), 0)
  INTO requested_count, valid_count, calculated_total FROM validated;

  IF requested_count <> valid_count OR calculated_total <= 0 THEN
    RAISE EXCEPTION 'Uno o più prodotti non sono disponibili';
  END IF;

  INSERT INTO public.orders (note, total, status)
  VALUES (NULLIF(left(trim(p_note), 500), ''), calculated_total, 'received')
  RETURNING * INTO new_order;

  WITH requested AS (
    SELECT (line->>'menu_item_id')::uuid AS menu_item_id,
      SUM((line->>'quantity')::int)::int AS quantity
    FROM jsonb_array_elements(p_lines) AS line
    GROUP BY (line->>'menu_item_id')::uuid
  )
  INSERT INTO public.order_items (order_id, menu_item_id, name, unit_price, quantity)
  SELECT new_order.id, menu_items.id, menu_items.name, menu_items.price, requested.quantity
  FROM requested JOIN public.menu_items ON menu_items.id = requested.menu_item_id;

  RETURN QUERY SELECT new_order.id, new_order.order_number, new_order.status,
    new_order.note, new_order.total, new_order.created_at, new_order.updated_at,
    new_order.estimated_ready_at, new_order.archived_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_kitchen_batch(p_preparation_seconds int DEFAULT 10)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF p_preparation_seconds < 1 OR p_preparation_seconds > 3600 THEN
    RAISE EXCEPTION 'Durata preparazione non valida';
  END IF;
  UPDATE public.orders SET status = 'ready'
  WHERE status = 'preparing' AND archived_at IS NULL AND estimated_ready_at <= now();
  UPDATE public.orders
  SET status = 'preparing',
    estimated_ready_at = now() + make_interval(secs => p_preparation_seconds)
  WHERE status = 'received' AND archived_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bar_order(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_kitchen_batch(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bar_order(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_kitchen_batch(int) TO service_role;
