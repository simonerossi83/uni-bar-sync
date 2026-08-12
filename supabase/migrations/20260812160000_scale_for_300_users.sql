ALTER TABLE public.orders
  ADD COLUMN client_request_id uuid;

CREATE UNIQUE INDEX orders_client_request_id_idx
  ON public.orders (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX orders_active_order_number_idx
  ON public.orders (order_number)
  WHERE archived_at IS NULL;

CREATE INDEX menu_items_category_sort_idx
  ON public.menu_items (category, sort_order);

DROP FUNCTION public.create_bar_order(jsonb, text);

CREATE FUNCTION public.create_bar_order(
  p_lines jsonb,
  p_note text,
  p_client_request_id uuid
)
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
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'Identificativo richiesta mancante';
  END IF;

  -- Serialize retries of the same request without blocking unrelated customers.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_request_id::text, 0));

  SELECT * INTO new_order
  FROM public.orders
  WHERE client_request_id = p_client_request_id;

  IF FOUND THEN
    RETURN QUERY SELECT new_order.id, new_order.order_number, new_order.status,
      new_order.note, new_order.total, new_order.created_at, new_order.updated_at,
      new_order.estimated_ready_at, new_order.archived_at;
    RETURN;
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0
    OR jsonb_array_length(p_lines) > 50 THEN
    RAISE EXCEPTION 'Ordine non valido';
  END IF;

  -- Lock products in a stable order so concurrent orders cannot oversell stock.
  PERFORM menu_items.id
  FROM public.menu_items
  JOIN (
    SELECT (line->>'menu_item_id')::uuid AS menu_item_id,
      SUM((line->>'quantity')::int)::int AS quantity
    FROM jsonb_array_elements(p_lines) AS line
    GROUP BY (line->>'menu_item_id')::uuid
  ) requested ON requested.menu_item_id = menu_items.id
  ORDER BY menu_items.id
  FOR UPDATE OF menu_items;

  WITH requested AS (
    SELECT (line->>'menu_item_id')::uuid AS menu_item_id,
      SUM((line->>'quantity')::int)::int AS quantity
    FROM jsonb_array_elements(p_lines) AS line
    GROUP BY (line->>'menu_item_id')::uuid
  ), validated AS (
    SELECT requested.menu_item_id, requested.quantity, menu_items.price
    FROM requested
    JOIN public.menu_items ON menu_items.id = requested.menu_item_id
    WHERE menu_items.available
      AND requested.quantity BETWEEN 1 AND 20
      AND menu_items.stock_quantity >= requested.quantity
  )
  SELECT (SELECT count(*) FROM requested), count(*),
    COALESCE(sum(validated.price * validated.quantity), 0)
  INTO requested_count, valid_count, calculated_total
  FROM validated;

  IF requested_count <> valid_count OR calculated_total <= 0 THEN
    RAISE EXCEPTION 'Uno o piu prodotti non sono disponibili nella quantita richiesta';
  END IF;

  INSERT INTO public.orders (note, total, status, client_request_id)
  VALUES (
    NULLIF(left(trim(p_note), 500), ''),
    calculated_total,
    'received',
    p_client_request_id
  )
  RETURNING * INTO new_order;

  WITH requested AS (
    SELECT (line->>'menu_item_id')::uuid AS menu_item_id,
      SUM((line->>'quantity')::int)::int AS quantity
    FROM jsonb_array_elements(p_lines) AS line
    GROUP BY (line->>'menu_item_id')::uuid
  )
  INSERT INTO public.order_items (order_id, menu_item_id, name, unit_price, quantity)
  SELECT new_order.id, menu_items.id, menu_items.name, menu_items.price, requested.quantity
  FROM requested
  JOIN public.menu_items ON menu_items.id = requested.menu_item_id;

  WITH requested AS (
    SELECT (line->>'menu_item_id')::uuid AS menu_item_id,
      SUM((line->>'quantity')::int)::int AS quantity
    FROM jsonb_array_elements(p_lines) AS line
    GROUP BY (line->>'menu_item_id')::uuid
  )
  UPDATE public.menu_items
  SET stock_quantity = menu_items.stock_quantity - requested.quantity,
    available = (menu_items.stock_quantity - requested.quantity) > 0
  FROM requested
  WHERE menu_items.id = requested.menu_item_id;

  RETURN QUERY SELECT new_order.id, new_order.order_number, new_order.status,
    new_order.note, new_order.total, new_order.created_at, new_order.updated_at,
    new_order.estimated_ready_at, new_order.archived_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bar_order(jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bar_order(jsonb, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.advance_kitchen_batch(p_preparation_seconds int DEFAULT 10)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  lock_acquired boolean;
BEGIN
  IF p_preparation_seconds < 1 OR p_preparation_seconds > 3600 THEN
    RAISE EXCEPTION 'Durata preparazione non valida';
  END IF;

  SELECT pg_try_advisory_xact_lock(hashtextextended('uni-bar-kitchen-batch', 0))
  INTO lock_acquired;
  IF NOT lock_acquired THEN
    RETURN;
  END IF;

  UPDATE public.orders
  SET status = 'ready'
  WHERE status = 'preparing'
    AND archived_at IS NULL
    AND estimated_ready_at <= now();

  UPDATE public.orders
  SET status = 'preparing',
    estimated_ready_at = now() + make_interval(secs => p_preparation_seconds)
  WHERE status = 'received'
    AND archived_at IS NULL;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'uni-bar-advance-orders',
  '10 seconds',
  $job$SELECT public.advance_kitchen_batch(10);$job$
);

SELECT cron.schedule(
  'uni-bar-clean-cron-history',
  '15 3 * * *',
  $job$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';$job$
);
