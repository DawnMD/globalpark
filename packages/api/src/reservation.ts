import { os } from "@orpc/server";
import { z } from "zod";
import { createHold, releaseHold } from "@parking-network/db/src/reservations";

/**
 * D13: the operator dashboard is a route group in the web app, not a
 * separate deployable, but its oRPC procedures live in this standalone
 * package so they can be consumed as a typed client from any app. These
 * procedures are deliberately headless in Phase 2 -- `.callable()`
 * makes each one invocable directly (see reservation.test.ts), with no
 * HTTP route or Next.js scaffold required until Phase 3 mounts one.
 *
 * The procedures are a thin validation boundary over
 * packages/db/src/reservations.ts: business outcomes (CONFLICT,
 * EXPIRED, ...) stay in the typed result union rather than becoming
 * thrown errors, matching how the transactional functions already
 * model them.
 */
const createHoldInputSchema = z.object({
  zoneId: z.uuid(),
  userId: z.uuid(),
  vehicleId: z.uuid().optional(),
  holdDurationMs: z.number().int().positive().optional(),
});

const createHoldOutputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), reservationId: z.uuid(), heldUntil: z.date() }),
  z.object({ ok: z.literal(false), reason: z.literal("CONFLICT") }),
]);

export const createHoldProcedure = os
  .input(createHoldInputSchema)
  .output(createHoldOutputSchema)
  .handler(async ({ input }) => createHold(input))
  .callable();

const releaseHoldInputSchema = z.object({
  reservationId: z.uuid(),
});

const releaseHoldOutputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["NOT_FOUND", "ALREADY_CANCELLED", "ALREADY_CONVERTED", "EXPIRED"]),
  }),
]);

export const releaseHoldProcedure = os
  .input(releaseHoldInputSchema)
  .output(releaseHoldOutputSchema)
  .handler(async ({ input }) => releaseHold(input.reservationId))
  .callable();

export const reservationRouter = {
  createHold: createHoldProcedure,
  releaseHold: releaseHoldProcedure,
};
