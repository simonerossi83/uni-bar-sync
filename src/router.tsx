import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

const requestNonce = createIsomorphicFn()
  .server(async () => {
    const { getCspNonce } = await import("./lib/security-headers.server");
    return getCspNonce();
  })
  .client(() => undefined);

export const getRouter = async () => {
  const nonce = await requestNonce();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        retryDelay: (attempt) =>
          Math.min(500 * 2 ** attempt, 4_000) + Math.floor(Math.random() * 500),
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });

  const router = createRouter({
    // HeadContent, Scripts and streaming SSR all consume this built-in option.
    // Client hydration restores it from TanStack's csp-nonce meta element.
    ssr: nonce ? { nonce } : {},
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
