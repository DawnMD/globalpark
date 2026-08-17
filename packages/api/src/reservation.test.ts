import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "@parking-network/db/src/env";
import { createHoldProcedure, releaseHoldProcedure } from "./reservation";

/**
 * Exercises the oRPC procedures directly via `.callable()` -- no HTTP
 * server, no Next.js route, matching Phase 2's "headless" scope (the
 * Next.js scaffold arrives Phase 3). Fixture setup is intentionally
 * minimal and local to this file rather than reaching into
 * packages/db's test helpers, keeping the package boundary honest.
 */
const sql = postgres(env.DATABASE_URL_SESSION, { prepare: false });

let zoneId: string | undefined;
let cleanupIds: { floorId: string; facilityId: string; operatorId: string } | undefined;

afterEach(async () => {
  if (zoneId) {
    await sql`DELETE FROM parking_event WHERE entity_id IN (SELECT id FROM reservation WHERE zone_id = ${zoneId})`;
    await sql`DELETE FROM reservation WHERE zone_id = ${zoneId}`;
    await sql`DELETE FROM parking_zone WHERE id = ${zoneId}`;
  }
  if (cleanupIds) {
    await sql`DELETE FROM floor WHERE id = ${cleanupIds.floorId}`;
    await sql`DELETE FROM facility WHERE id = ${cleanupIds.facilityId}`;
    await sql`DELETE FROM operator WHERE id = ${cleanupIds.operatorId}`;
  }
  zoneId = undefined;
  cleanupIds = undefined;
});

async function createFixtureZone(capacity: number): Promise<string> {
  const [operator] =
    await sql`INSERT INTO operator (name) VALUES ('oRPC Test Operator') RETURNING id`;
  const [facility] =
    await sql`INSERT INTO facility (operator_id, name) VALUES (${operator.id}, 'oRPC Test Facility') RETURNING id`;
  const [floor] =
    await sql`INSERT INTO floor (facility_id, name, level) VALUES (${facility.id}, 'Ground', 0) RETURNING id`;
  const [zone] = await sql`
    INSERT INTO parking_zone (floor_id, name, capacity, held_count, occupied_count)
    VALUES (${floor.id}, 'Z', ${capacity}, 0, 0)
    RETURNING id
  `;
  cleanupIds = { floorId: floor.id, facilityId: facility.id, operatorId: operator.id };
  return zone.id;
}

describe("reservation oRPC procedures (Phase 2, headless)", () => {
  it("createHold validates input and delegates to the transactional function", async () => {
    zoneId = await createFixtureZone(1);

    const result = await createHoldProcedure({ zoneId, userId: randomUUID() });

    expect(result.ok).toBe(true);
  });

  it("createHold rejects malformed input before it reaches the database", async () => {
    await expect(
      createHoldProcedure({ zoneId: "not-a-uuid", userId: randomUUID() }),
    ).rejects.toThrow();
  });

  it("releaseHold round-trips a hold created through createHold", async () => {
    zoneId = await createFixtureZone(1);
    const hold = await createHoldProcedure({ zoneId, userId: randomUUID() });
    if (!hold.ok) throw new Error("expected hold to succeed");

    const result = await releaseHoldProcedure({ reservationId: hold.reservationId });

    expect(result).toEqual({ ok: true });
  });

  it("createHold reports CONFLICT once the zone is full, matching the DB-level result", async () => {
    zoneId = await createFixtureZone(1);
    await createHoldProcedure({ zoneId, userId: randomUUID() });

    const result = await createHoldProcedure({ zoneId, userId: randomUUID() });

    expect(result).toEqual({ ok: false, reason: "CONFLICT" });
  });
});
