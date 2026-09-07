import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMenu, fetchMenuStock } from "@/lib/bar";

export function useMenu(kitchen = false) {
  const queryClient = useQueryClient();
  const refreshMs = useMemo(
    () =>
      kitchen
        ? 4_000 + Math.floor(Math.random() * 2_000)
        : 20_000 + Math.floor(Math.random() * 10_000),
    [kitchen],
  );
  const catalog = useQuery({
    queryKey: ["menu", "catalog"],
    queryFn: async () => {
      const menu = await fetchMenu();
      // Reuse the full-menu response: no second request on the first visit.
      queryClient.setQueryData(
        ["menu", "stock"],
        menu.map(({ id, available, stock_quantity }) => ({ id, available, stock_quantity })),
      );
      return menu;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000 + refreshMs,
    refetchIntervalInBackground: false,
  });
  const stock = useQuery({
    queryKey: ["menu", "stock"],
    queryFn: fetchMenuStock,
    enabled: Boolean(catalog.data),
    staleTime: kitchen ? 2_000 : 10_000,
    refetchInterval: refreshMs,
    refetchIntervalInBackground: false,
  });
  const data = useMemo(() => {
    // Ignore an older stock snapshot after a fresh full-menu response.
    const latest = new Map(
      stock.dataUpdatedAt >= catalog.dataUpdatedAt
        ? stock.data?.map((item) => [item.id, item])
        : [],
    );
    return (catalog.data ?? []).map((item) => ({ ...item, ...latest.get(item.id) }));
  }, [catalog.data, catalog.dataUpdatedAt, stock.data, stock.dataUpdatedAt]);
  return { data, isLoading: catalog.isLoading, isError: catalog.isError || stock.isError };
}
