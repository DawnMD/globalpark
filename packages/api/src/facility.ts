import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
  getFacilityReservations,
  getFacilityZones,
  isFacilityAccessibleToUser,
  listFacilitiesForUser,
} from "@parking-network/db/src/facility-overview";
import { authed } from "./auth-middleware";

/**
 * Read-side procedures for the operator dashboard (Phase 3). Thin
 * validation boundary over packages/db/src/facility-overview.ts, same
 * pattern as reservation.ts's write-path procedures. All three require
 * a session (D12's "operator-scoped access"); zones/reservations
 * additionally check the requested facility belongs to one of the
 * caller's operators before querying it.
 */

export const listFacilitiesProcedure = authed
  .output(z.array(z.object({ facilityId: z.string().uuid(), facilityName: z.string() })))
  .handler(async ({ context }) => listFacilitiesForUser(context.session.user.id));

const facilityIdInputSchema = z.object({ facilityId: z.string().uuid() });

async function assertFacilityAccess(userId: string, facilityId: string): Promise<void> {
  const allowed = await isFacilityAccessibleToUser(userId, facilityId);
  if (!allowed) {
    throw new ORPCError("FORBIDDEN");
  }
}

export const getFacilityZonesProcedure = authed
  .input(facilityIdInputSchema)
  .output(
    z.array(
      z.object({
        zoneId: z.string().uuid(),
        zoneName: z.string(),
        floorName: z.string(),
        floorLevel: z.number().int(),
        capacity: z.number().int(),
        heldCount: z.number().int(),
        occupiedCount: z.number().int(),
      }),
    ),
  )
  .handler(async ({ input, context }) => {
    await assertFacilityAccess(context.session.user.id, input.facilityId);
    return getFacilityZones(input.facilityId);
  });

export const getFacilityReservationsProcedure = authed
  .input(facilityIdInputSchema)
  .output(
    z.array(
      z.object({
        reservationId: z.string().uuid(),
        zoneId: z.string().uuid(),
        zoneName: z.string(),
        status: z.enum(["HELD", "EXPIRED", "CANCELLED", "CONVERTED"]),
        heldUntil: z.date(),
        createdAt: z.date(),
      }),
    ),
  )
  .handler(async ({ input, context }) => {
    await assertFacilityAccess(context.session.user.id, input.facilityId);
    return getFacilityReservations(input.facilityId);
  });

export const facilityRouter = {
  list: listFacilitiesProcedure,
  zones: getFacilityZonesProcedure,
  reservations: getFacilityReservationsProcedure,
};
