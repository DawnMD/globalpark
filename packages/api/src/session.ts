import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { SPOT_EVENTS } from "@parking-network/domain";
import { startSession, endSessionForVehicle } from "@parking-network/db/src/sessions";
import { applySpotTransition, isSpotInFacility } from "@parking-network/db/src/spot-transitions";
import { resolveVehicleByPlate } from "@parking-network/db/src/vehicles";
import { deviceAuthed } from "./auth-middleware";

/**
 * Device-authenticated procedures for the terminal (Phase 4, D16).
 * `deviceAuthed` resolves context.device from the bearer token verified
 * in apps/web's rpc route; every handler trusts context.device.facilityId
 * as the calling device's own facility -- that's all a device token
 * proves, and it's enough: startSession only ever looks for a spot
 * within that facility, and the other two handlers check it explicitly.
 */

const entryInputSchema = z.object({
  vehicleId: z.uuid(),
  /** Omit for a walk-up -- D4's "arrived without a hold" path. */
  reservationId: z.uuid().optional(),
});

const entryOutputSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    sessionId: z.uuid(),
    spotId: z.uuid(),
    spotLabel: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum([
      "NO_AVAILABLE_SPOT",
      "RESERVATION_NOT_AVAILABLE",
      "NO_CAPACITY",
      "VEHICLE_ALREADY_PARKED",
    ]),
  }),
]);

export const entryProcedure = deviceAuthed
  .input(entryInputSchema)
  .output(entryOutputSchema)
  .handler(async ({ input, context }) =>
    startSession({
      facilityId: context.device.facilityId,
      vehicleId: input.vehicleId,
      reservationId: input.reservationId,
    }),
  );

const exitInputSchema = z.object({ vehicleId: z.uuid() });

const exitOutputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["NOT_FOUND", "ALREADY_ENDED", "WRONG_FACILITY"]),
  }),
]);

export const exitProcedure = deviceAuthed
  .input(exitInputSchema)
  .output(exitOutputSchema)
  .handler(async ({ input, context }) =>
    endSessionForVehicle(input.vehicleId, context.device.facilityId),
  );

const sensorEventInputSchema = z.object({
  spotId: z.uuid(),
  event: z.enum(SPOT_EVENTS),
});

const sensorEventOutputSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    status: z.enum(["AVAILABLE", "OCCUPIED", "BLOCKED", "OUT_OF_SERVICE"]),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

/**
 * D5's raw sensor vocabulary: the terminal's `occupy`/`release`
 * commands, plus block/unblock/fault/repair for maintenance, all
 * uncoupled from the session lifecycle above (see spot-transitions.ts).
 */
export const sensorEventProcedure = deviceAuthed
  .input(sensorEventInputSchema)
  .output(sensorEventOutputSchema)
  .handler(async ({ input, context }) => {
    const inFacility = await isSpotInFacility(input.spotId, context.device.facilityId);
    if (!inFacility) {
      throw new ORPCError("FORBIDDEN");
    }
    return applySpotTransition(input.spotId, input.event);
  });

const resolvePlateInputSchema = z.object({ licensePlate: z.string().min(1) });
const resolvePlateOutputSchema = z.object({ vehicleId: z.uuid() });

/**
 * A terminal reads a license plate, not a vehicle id -- this is how it
 * turns one into the other before calling entry/exit. Device-authed
 * (not public) even though vehicles themselves aren't facility-scoped
 * (D12): only authenticated devices get to mint/look up vehicle rows.
 */
export const resolvePlateProcedure = deviceAuthed
  .input(resolvePlateInputSchema)
  .output(resolvePlateOutputSchema)
  .handler(async ({ input }) => ({
    vehicleId: await resolveVehicleByPlate(input.licensePlate),
  }));

export const sessionRouter = {
  entry: entryProcedure,
  exit: exitProcedure,
  sensorEvent: sensorEventProcedure,
  resolvePlate: resolvePlateProcedure,
};
