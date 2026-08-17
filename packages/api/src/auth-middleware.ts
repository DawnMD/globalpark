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

/**
 * The terminal's counterpart to `authed`: requires a verified device
 * token (D16) instead of a user session. Per-facility scoping happens
 * inside each handler (session.ts), same reasoning as `authed` --
 * it needs the validated input, not just the fact that some device
 * authenticated.
 */
export const deviceAuthed = os.$context<AuthContext>().use(({ context, next }) => {
  if (!context.device) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context: { device: context.device } });
});
