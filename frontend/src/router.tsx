import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        retryDelay: 500,
        // Cached data shows instantly on navigation; no refetch on window focus
        // (the source of flicker/perceived slowness). Background refresh keeps it fresh.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // NOTE: defaultPreload:"intent" was removed — it triggered a router
    // "_nonReactive" TypeError during hover-preload. The query-cache config above
    // (staleTime + no focus refetch) already delivers instant cached navigation.
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};
