import { os } from "@orpc/server";
import { z } from "zod";
import {
  getFacilityReservations,
  getFacilityZones,
  listFacilities,
} from "@parking-network/db/src/facility-overview";

/**
 * Read-side procedures for the operator dashboard (Phase 3). Thin
 * validation boundary over packages/db/src/facility-overview.ts, same
 * pattern as reservation.ts's write-path procedures.
 */

export const listFacilitiesProcedure = os
  .output(z.array(z.object({ facilityId: z.string().uuid(), facilityName: z.string() })))
  .handler(async () => listFacilities())
  .callable();

const facilityIdInputSchema = z.object({ facilityId: z.string().uuid() });

export const getFacilityZonesProcedure = os
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
  .handler(async ({ input }) => getFacilityZones(input.facilityId))
  .callable();

export const getFacilityReservationsProcedure = os
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
  .handler(async ({ input }) => getFacilityReservations(input.facilityId))
  .callable();

export const facilityRouter = {
  list: listFacilitiesProcedure,
  zones: getFacilityZonesProcedure,
  reservations: getFacilityReservationsProcedure,
};
