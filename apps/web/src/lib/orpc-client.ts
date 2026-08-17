"use client";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { router } from "@parking-network/api";

/**
 * Browser-only typed client, talking to the route mounted at
 * app/api/rpc. Server Components/Route Handlers should import
 * `@parking-network/api`'s procedures directly instead -- they're
 * `.callable()` (Phase 2), so there's no reason to round-trip through
 * HTTP from code that's already running on the server.
 */
const link = new RPCLink({
  url: () => new URL("/api/rpc", window.location.origin),
});

export const orpc: RouterClient<typeof router> = createORPCClient(link);
