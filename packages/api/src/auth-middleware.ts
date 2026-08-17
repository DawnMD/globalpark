import { ORPCError, os } from "@orpc/server";
import type { AuthContext } from "./context";

/**
 * Base authentication gate: any procedure built from `authed` instead
 * of bare `os` requires a session. Per-facility authorization (D12,
 * "operator-scoped access") happens inside each handler, not here --
 * it needs the validated input (facilityId), which isn't available
 * until after `.input()` runs.
 */
export const authed = os.$context<AuthContext>().use(({ context, next }) => {
  if (!context.session) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context: { session: context.session } });
});
