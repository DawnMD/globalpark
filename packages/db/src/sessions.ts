import { and, eq, sql } from "drizzle-orm";
import { SESSION_EVENT_KINDS } from "@parking-network/domain";
import { db } from "./client";
import {
  floor,
  parkingEvent,
  parkingSession,
  parkingSpot,
  parkingZone,
  reservation,
} from "./schema";
import { resolveFacilityTopic } from "./topics";

export type StartSessionFailureReason =
  "NO_AVAILABLE_SPOT" | "RESERVATION_NOT_AVAILABLE" | "NO_CAPACITY" | "VEHICLE_ALREADY_PARKED";

export type StartSessionResult =
  | { ok: true; sessionId: string; spotId: string; spotLabel: string }
  | { ok: false; reason: StartSessionFailureReason };

class StartSessionConflict extends Error {
  constructor(public reason: StartSessionFailureReason) {
    super(reason);
  }
}

/** postgres.js error shape for a unique-violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown, constraintName: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505" &&
    "constraint_name" in err &&
    (err as { constraint_name?: string }).constraint_name === constraintName
  );
}

export type StartSessionInput = {
  facilityId: string;
  vehicleId: string;
  /** Omit for a walk-up (D4's "arrived without a hold" path). */
  reservationId?: string;
};

/**
 * D4: "the physical spot is assigned at the gate." The gate (this
 * function, called by a terminal's `entry` event) picks the spot, not
 * the device -- a device reports a vehicle and, if it has one, a
 * reservation; it never names a spot.
 *
 * `FOR UPDATE SKIP LOCKED` is D2's other reason for choosing Drizzle
 * over Prisma: it lets concurrent gate entries race for *distinct*
 * available spots (each locks and skips past whatever the other
 * transaction already claimed) instead of serializing on one lock or
 * double-assigning the same spot. This is a different concurrency
 * technique than D4's hot-row zone counter (createHold) -- deliberately,
 * since the two problems (a shared counter vs. a pool of interchangeable
 * rows) call for different tools.
 *
 * With a reservationId, the reservation is validated and converted
 * (HELD -> CONVERTED) inside the same transaction as the spot pick, and
 * the zone's held_count/occupied_count swap by one unit each -- the
 * total is unchanged, so this can never trip the capacity_not_exceeded
 * CHECK. Without one (walk-up), occupied_count alone is incremented,
 * gated on spare capacity the same way createHold gates held_count --
 * so a walk-up can be turned away at a *logically* full zone even
 * though a physical spot is sitting AVAILABLE (that spot is the one
 * capacity is holding open for a pending reservation). This is the
 * server enforcing capacity at the moment of entry because the network
 * is up (Phase 4's "while the network is perfect"); D9's "physical
 * occupancy is authoritative and unconditional" is about what an
 * *offline* terminal does on its own authority, which is Phase 5.
 */
export async function startSession(input: StartSessionInput): Promise<StartSessionResult> {
  try {
    return await db.transaction(async (tx) => {
      let zoneId: string | undefined;

      if (input.reservationId) {
        const [reservationRow] = await tx
          .select({ zoneId: reservation.zoneId })
          .from(reservation)
          .where(
            and(
              eq(reservation.id, input.reservationId),
              eq(reservation.status, "HELD"),
              sql`${reservation.heldUntil} >= now()`,
            ),
          );
        if (!reservationRow) throw new StartSessionConflict("RESERVATION_NOT_AVAILABLE");
        zoneId = reservationRow.zoneId;
      }

      const [spotRow] = await tx
        .select({ spotId: parkingSpot.id, zoneId: parkingSpot.zoneId, label: parkingSpot.label })
        .from(parkingSpot)
        .innerJoin(parkingZone, eq(parkingSpot.zoneId, parkingZone.id))
        .innerJoin(floor, eq(parkingZone.floorId, floor.id))
        .where(
          and(
            eq(floor.facilityId, input.facilityId),
            eq(parkingSpot.status, "AVAILABLE"),
            zoneId ? eq(parkingSpot.zoneId, zoneId) : undefined,
          ),
        )
        .limit(1)
        .for("update", { of: parkingSpot, skipLocked: true });
      if (!spotRow) {
        // Reachable even with a valid reservation: the zone's counters
        // said capacity was available but no physical spot in the pool
        // currently is -- a counters/physical drift that Phase 5's
        // snapshot reconciliation (D11) exists to catch and correct.
        throw new StartSessionConflict("NO_AVAILABLE_SPOT");
      }

      await tx
        .update(parkingSpot)
        .set({ status: "OCCUPIED" })
        .where(eq(parkingSpot.id, spotRow.spotId));

      if (input.reservationId) {
        await tx
          .update(reservation)
          .set({ status: "CONVERTED", updatedAt: sql`now()` })
          .where(eq(reservation.id, input.reservationId));
        await tx
          .update(parkingZone)
          .set({
            heldCount: sql`${parkingZone.heldCount} - 1`,
            occupiedCount: sql`${parkingZone.occupiedCount} + 1`,
          })
          .where(eq(parkingZone.id, spotRow.zoneId));
      } else {
        const [zoneRow] = await tx
          .update(parkingZone)
          .set({ occupiedCount: sql`${parkingZone.occupiedCount} + 1` })
          .where(
            and(
              eq(parkingZone.id, spotRow.zoneId),
              sql`${parkingZone.heldCount} + ${parkingZone.occupiedCount} < ${parkingZone.capacity}`,
            ),
          )
          .returning({ id: parkingZone.id });
        if (!zoneRow) throw new StartSessionConflict("NO_CAPACITY");
      }

      const [sessionRow] = await tx
        .insert(parkingSession)
        .values({
          spotId: spotRow.spotId,
          vehicleId: input.vehicleId,
          reservationId: input.reservationId,
        })
        .returning();

      await tx.insert(parkingEvent).values({
        topic: await resolveFacilityTopic(tx, spotRow.zoneId),
        kind: SESSION_EVENT_KINDS.STARTED,
        entityType: "session",
        entityId: sessionRow.id,
        occurredAt: sql`now()`,
        payload: {
          spotId: spotRow.spotId,
          vehicleId: input.vehicleId,
          reservationId: input.reservationId ?? null,
        },
      });

      return {
        ok: true,
        sessionId: sessionRow.id,
        spotId: spotRow.spotId,
        spotLabel: spotRow.label,
      };
    });
  } catch (err) {
    if (err instanceof StartSessionConflict) {
      return { ok: false, reason: err.reason };
    }
    if (isUniqueViolation(err, "one_active_session_per_vehicle")) {
      return { ok: false, reason: "VEHICLE_ALREADY_PARKED" };
    }
    throw err;
  }
}

export type EndSessionFailureReason = "NOT_FOUND" | "ALREADY_ENDED" | "WRONG_FACILITY";

export type EndSessionResult = { ok: true } | { ok: false; reason: EndSessionFailureReason };

/**
 * Ends the vehicle's ACTIVE session (a device reports a vehicle
 * leaving, not a session id -- it doesn't track those). `facilityId`
 * scopes this to the calling device's own facility (D12-style defense
 * in depth: a device's token only proves which facility it belongs
 * to, so a session at a different facility must be invisible to it,
 * not just "not found" for an unrelated reason).
 */
export async function endSessionForVehicle(
  vehicleId: string,
  facilityId: string,
): Promise<EndSessionResult> {
  return db.transaction(async (tx) => {
    const [active] = await tx
      .select({ sessionId: parkingSession.id, spotId: parkingSession.spotId })
      .from(parkingSession)
      .where(and(eq(parkingSession.vehicleId, vehicleId), eq(parkingSession.status, "ACTIVE")));

    if (!active) {
      return { ok: false, reason: "NOT_FOUND" };
    }

    const [spotRow] = await tx
      .select({ zoneId: parkingSpot.zoneId, facilityId: floor.facilityId })
      .from(parkingSpot)
      .innerJoin(parkingZone, eq(parkingSpot.zoneId, parkingZone.id))
      .innerJoin(floor, eq(parkingZone.floorId, floor.id))
      .where(eq(parkingSpot.id, active.spotId));

    if (spotRow.facilityId !== facilityId) {
      return { ok: false, reason: "WRONG_FACILITY" };
    }

    const [endedRow] = await tx
      .update(parkingSession)
      .set({ status: "ENDED", endedAt: sql`now()` })
      .where(and(eq(parkingSession.id, active.sessionId), eq(parkingSession.status, "ACTIVE")))
      .returning();
    if (!endedRow) {
      // Raced with another end for the same session between the reads
      // above and this update -- self-correcting on retry.
      return { ok: false, reason: "ALREADY_ENDED" };
    }

    await tx
      .update(parkingSpot)
      .set({ status: "AVAILABLE" })
      .where(eq(parkingSpot.id, active.spotId));

    await tx
      .update(parkingZone)
      .set({ occupiedCount: sql`${parkingZone.occupiedCount} - 1` })
      .where(eq(parkingZone.id, spotRow.zoneId));

    await tx.insert(parkingEvent).values({
      topic: await resolveFacilityTopic(tx, spotRow.zoneId),
      kind: SESSION_EVENT_KINDS.ENDED,
      entityType: "session",
      entityId: active.sessionId,
      occurredAt: sql`now()`,
      payload: { spotId: active.spotId, vehicleId },
    });

    return { ok: true };
  });
}
