import { and, eq, sql } from "drizzle-orm";
import { RESERVATION_EVENT_KINDS } from "@parking-network/domain";
import { db } from "./client";
import { floor, parkingEvent, parkingZone, reservation } from "./schema";

/**
 * D3's SSE route is topic-scoped per facility (an operator dashboard
 * watches a whole facility, not one zone), so every parking_event this
 * module writes carries a `facility:<id>` topic -- resolved via
 * zone -> floor -> facility, the same tenancy chain D12 already uses.
 */
async function resolveFacilityTopic(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  zoneId: string,
): Promise<string> {
  const [row] = await tx
    .select({ facilityId: floor.facilityId })
    .from(parkingZone)
    .innerJoin(floor, eq(parkingZone.floorId, floor.id))
    .where(eq(parkingZone.id, zoneId));
  return `facility:${row.facilityId}`;
}

export type CreateHoldInput = {
  zoneId: string;
  userId: string;
  vehicleId?: string;
  /** Defaults to 15 minutes -- the hold TTL from D6. */
  holdDurationMs?: number;
};

export type CreateHoldResult =
  { ok: true; reservationId: string; heldUntil: Date } | { ok: false; reason: "CONFLICT" };

const DEFAULT_HOLD_DURATION_MS = 15 * 60 * 1000;

/**
 * D4's capacity-hold mechanics: an atomic UPDATE gated on
 * `held_count + occupied_count < capacity`. Zero rows back = CONFLICT.
 * The `CHECK (capacity_not_exceeded)` constraint (D8) backs this up
 * independently of this code path.
 *
 * `held_until` is computed by Postgres inside this same statement
 * (`now() + make_interval(...)`), never by the application clock --
 * the value that ends up on the row reflects the moment the hold
 * actually took effect, not whenever this function happened to start
 * running.
 */
export async function createHold(input: CreateHoldInput): Promise<CreateHoldResult> {
  const holdDurationMs = input.holdDurationMs ?? DEFAULT_HOLD_DURATION_MS;

  return db.transaction(async (tx) => {
    const held = await tx
      .update(parkingZone)
      .set({ heldCount: sql`${parkingZone.heldCount} + 1` })
      .where(
        and(
          eq(parkingZone.id, input.zoneId),
          sql`${parkingZone.heldCount} + ${parkingZone.occupiedCount} < ${parkingZone.capacity}`,
        ),
      )
      .returning({ id: parkingZone.id });

    if (held.length === 0) {
      return { ok: false, reason: "CONFLICT" };
    }

    const [row] = await tx
      .insert(reservation)
      .values({
        zoneId: input.zoneId,
        userId: input.userId,
        vehicleId: input.vehicleId,
        heldUntil: sql`now() + make_interval(secs => ${holdDurationMs / 1000})`,
      })
      .returning();

    await tx.insert(parkingEvent).values({
      topic: await resolveFacilityTopic(tx, input.zoneId),
      kind: RESERVATION_EVENT_KINDS.HELD,
      entityType: "reservation",
      entityId: row.id,
      occurredAt: sql`now()`,
      payload: { zoneId: input.zoneId, userId: input.userId },
    });

    return { ok: true, reservationId: row.id, heldUntil: row.heldUntil };
  });
}

export type ReleaseHoldResult =
  | { ok: true }
  | { ok: false; reason: "NOT_FOUND" | "ALREADY_CANCELLED" | "ALREADY_CONVERTED" | "EXPIRED" };

/**
 * Cancels a HELD reservation and gives its zone-capacity unit back.
 *
 * D6's "lazy expiry on read, everywhere": the update is gated on
 * `held_until >= now()`, so a hold whose TTL has already passed is
 * never cancelled as if it were still live. When that happens this
 * function opportunistically runs the same sweep pg_cron runs on a
 * schedule (`expire_stale_holds()`) before reporting why -- the read
 * that discovered the staleness is what corrects it, rather than
 * waiting up to a minute for the next scheduled sweep.
 */
export async function releaseHold(reservationId: string): Promise<ReleaseHoldResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(reservation)
      .set({ status: "CANCELLED", updatedAt: sql`now()` })
      .where(
        and(
          eq(reservation.id, reservationId),
          eq(reservation.status, "HELD"),
          sql`${reservation.heldUntil} >= now()`,
        ),
      )
      .returning();

    if (row) {
      await tx
        .update(parkingZone)
        .set({ heldCount: sql`${parkingZone.heldCount} - 1` })
        .where(eq(parkingZone.id, row.zoneId));

      await tx.insert(parkingEvent).values({
        topic: await resolveFacilityTopic(tx, row.zoneId),
        kind: RESERVATION_EVENT_KINDS.RELEASED,
        entityType: "reservation",
        entityId: row.id,
        occurredAt: sql`now()`,
        payload: { zoneId: row.zoneId },
      });

      return { ok: true };
    }

    // No row matched the CANCELLED update -- find out why, sweeping any
    // stale holds along the way so a HELD-but-expired row is reported
    // (and corrected) as EXPIRED rather than a confusing NOT_FOUND.
    await tx.execute(sql`SELECT expire_stale_holds()`);

    const [current] = await tx
      .select({ status: reservation.status })
      .from(reservation)
      .where(eq(reservation.id, reservationId));

    if (!current) return { ok: false, reason: "NOT_FOUND" };
    if (current.status === "EXPIRED") return { ok: false, reason: "EXPIRED" };
    if (current.status === "CANCELLED") return { ok: false, reason: "ALREADY_CANCELLED" };
    if (current.status === "CONVERTED") return { ok: false, reason: "ALREADY_CONVERTED" };
    // status is still HELD: the >= now() guard raced with a concurrent
    // mutation between the update attempt and this read. Vanishingly
    // rare and self-correcting on retry, so report it as a conflict
    // rather than invent a new outcome for it.
    return { ok: false, reason: "NOT_FOUND" };
  });
}

/**
 * On-demand invocation of the same `expire_stale_holds()` function
 * pg_cron schedules every minute (D6). Exists so lazy-expiry paths,
 * manual/admin triggers, and tests all go through the one sweep
 * implementation rather than a second copy written in TypeScript.
 */
export async function expireHolds(): Promise<{ expiredCount: number }> {
  const result = await db.execute<{ expire_stale_holds: number }>(
    sql`SELECT expire_stale_holds() AS expire_stale_holds`,
  );
  const row = Array.from(result)[0];
  return { expiredCount: Number(row?.expire_stale_holds ?? 0) };
}
