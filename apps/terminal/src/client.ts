import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { router } from "@parking-network/api";
import { env } from "./env";

/**
 * Same client shape as apps/web/src/lib/orpc-client.ts, pointed at a
 * remote server over plain HTTP (this process isn't the Next.js one)
 * and authenticated with this device's bearer token (D16) instead of
 * a browser session cookie.
 */
const link = new RPCLink({
  url: () => new URL("/api/rpc", env.TERMINAL_SERVER_URL),
  headers: () => ({ authorization: `Bearer ${env.TERMINAL_DEVICE_TOKEN}` }),
});

export const orpc: RouterClient<typeof router> = createORPCClient(link);
