ALTER TABLE public.menu_items
  ADD COLUMN initial_stock int NOT NULL DEFAULT 20,
  ADD COLUMN stock_quantity int NOT NULL DEFAULT 20;

ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_initial_stock_check CHECK (initial_stock > 0),
  ADD CONSTRAINT menu_items_stock_quantity_check CHECK (stock_quantity >= 0);

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

CREATE OR REPLACE FUNCTION public.restore_menu_stock()
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$
  UPDATE public.menu_items
  SET stock_quantity = initial_stock,
    available = true;
$$;

REVOKE ALL ON FUNCTION public.restore_menu_stock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_menu_stock() TO service_role;
