import type { DeviceKind } from "@parking-network/db/src/devices";

/**
 * Populated per-request by whatever mounts the router. apps/web's
 * app/api/rpc route resolves both of these independently -- Better
 * Auth's getSession for `session`, and a `Authorization: Bearer <token>`
 * header verified via verifyDeviceToken for `device` (D16, Phase 4) --
 * since dashboard users and terminal devices hit the same route with
 * different credentials. null means "not present"; procedures that
 * require one or the other go through `authed` / `deviceAuthed` in
 * auth-middleware.ts.
 */
export type AuthContext = {
  session: { user: { id: string } } | null;
  device: { deviceId: string; facilityId: string; kind: DeviceKind } | null;
};
