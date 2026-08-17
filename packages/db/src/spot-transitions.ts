import { and, eq, sql } from "drizzle-orm";
import {
  SPOT_EVENT_KINDS,
  transitionSpot,
  type SpotEvent,
  type SpotEventKind,
  type SpotStatus,
} from "@parking-network/domain";
import { db } from "./client";
import { floor, parkingEvent, parkingSpot, parkingZone } from "./schema";
import { resolveFacilityTopic } from "./topics";

/**
 * D12-style defense in depth for the device-authenticated oRPC
 * procedures (packages/api/src/session.ts): a device token proves
 * which facility a device belongs to, so a spot id from a different
 * facility must be rejected before applySpotTransition ever runs, not
 * just fail for an unrelated reason.
 */
export async function isSpotInFacility(spotId: string, facilityId: string): Promise<boolean> {
  const [row] = await db
    .select({ spotId: parkingSpot.id })
    .from(parkingSpot)
    .innerJoin(parkingZone, eq(parkingSpot.zoneId, parkingZone.id))
    .innerJoin(floor, eq(parkingZone.floorId, floor.id))
    .where(and(eq(parkingSpot.id, spotId), eq(floor.facilityId, facilityId)));
  return row !== undefined;
}

const KIND_BY_EVENT: Record<SpotEvent, SpotEventKind> = {
  occupy: SPOT_EVENT_KINDS.OCCUPY,
  release: SPOT_EVENT_KINDS.RELEASE,
  block: SPOT_EVENT_KINDS.BLOCK,
  unblock: SPOT_EVENT_KINDS.UNBLOCK,
  fault: SPOT_EVENT_KINDS.FAULT,
  repair: SPOT_EVENT_KINDS.REPAIR,
};

export type ApplySpotTransitionResult =
  { ok: true; status: SpotStatus } | { ok: false; reason: string };

/**
 * D5's raw spot vocabulary (occupy/release/block/unblock/fault/repair),
 * written by a sensor reporting what it physically observed --
 * deliberately uncoupled from the session lifecycle in sessions.ts.
 *
 * This is the terminal's `occupy`/`release` commands (a bare sensor
 * confirming occupancy with no gate, no vehicle, no reservation) as
 * well as maintenance events (`block`/`unblock`/`fault`/`repair`) that
 * have no session concept at all. Unlike startSession/endSession, this
 * never touches a zone's held_count/occupied_count -- a spot flipped by
 * a raw sensor event with no session behind it is exactly the kind of
 * counters/physical drift Phase 5's snapshot reconciliation (D11)
 * exists to detect and correct, not something to paper over here by
 * guessing at a counter adjustment.
 */
export async function applySpotTransition(
  spotId: string,
  event: SpotEvent,
): Promise<ApplySpotTransitionResult> {
  return db.transaction(async (tx) => {
    const [spot] = await tx
      .select({ status: parkingSpot.status, zoneId: parkingSpot.zoneId })
      .from(parkingSpot)
      .where(eq(parkingSpot.id, spotId));
    if (!spot) {
      return { ok: false, reason: `no such spot: ${spotId}` };
    }

    const transition = transitionSpot(spot.status, event);
    if (!transition.ok) {
      return transition;
    }

    await tx
      .update(parkingSpot)
      .set({ status: transition.status })
      .where(eq(parkingSpot.id, spotId));

    await tx.insert(parkingEvent).values({
      topic: await resolveFacilityTopic(tx, spot.zoneId),
      kind: KIND_BY_EVENT[event],
      entityType: "spot",
      entityId: spotId,
      occurredAt: sql`now()`,
      payload: { from: spot.status, to: transition.status },
    });

    return { ok: true, status: transition.status };
  });
}
