-- Take the same ordered row locks as create_bar_order before restoring stock.
-- Filename aligned with the version recorded by Supabase after application.
-- No stock is changed by this migration; only an authenticated restore calls it.
CREATE OR REPLACE FUNCTION public.restore_menu_stock()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  PERFORM id FROM public.menu_items ORDER BY id FOR UPDATE;
  UPDATE public.menu_items
  SET stock_quantity = initial_stock, available = true
  WHERE stock_quantity IS DISTINCT FROM initial_stock
    OR available IS DISTINCT FROM true;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_menu_stock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_menu_stock() TO service_role;

CREATE INDEX IF NOT EXISTS order_items_menu_item_id_idx ON public.order_items(menu_item_id);
