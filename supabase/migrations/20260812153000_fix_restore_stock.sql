CREATE OR REPLACE FUNCTION public.restore_menu_stock()
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$
  UPDATE public.menu_items
  SET stock_quantity = initial_stock,
    available = true
  WHERE stock_quantity IS DISTINCT FROM initial_stock
    OR available IS DISTINCT FROM true;
$$;
