import { RPCHandler } from "@orpc/server/fetch";
import { router } from "@parking-network/api";

/**
 * D13: the oRPC procedure layer lives in packages/api so it can be
 * consumed as a typed client from any app; this route is the one place
 * it's actually mounted over HTTP (Phase 2 kept it headless via
 * `.callable()` for direct invocation from tests).
 */
const handler = new RPCHandler(router);

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: "/api/rpc",
    context: {},
  });
  return response ?? new Response("Not found", { status: 404 });
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
