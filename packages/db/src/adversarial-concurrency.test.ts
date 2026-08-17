import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHold } from "./reservations";
import {
  cleanupTestZone,
  createTestZone,
  getZoneHeldCount,
  resetZoneReservations,
} from "./test/fixtures";

const CONCURRENT_ATTEMPTS = 200;
const TRIALS = 50;

/**
 * D15: the acceptance test for D4's capacity-hold mechanics. Two users
 * proves nothing about a hot-row UPDATE; 200 concurrent attempts
 * against a zone with exactly one remaining unit, asserting exactly
 * one success and 199 clean CONFLICTs with the counter landing exactly
 * at capacity, repeated 50x, is what actually exercises the
 * `held_count + occupied_count < capacity` race.
 *
 * Reuses a single zone across all 50 trials (resetting reservations
 * and the counter between them) rather than re-provisioning
 * operator/facility/floor/zone 50 times -- the thing under test is the
 * concurrent UPDATE, not fixture setup.
 */
describe("D15: adversarial concurrency", () => {
  it(`exactly one success per zone-unit under ${CONCURRENT_ATTEMPTS}-way concurrent contention, ${TRIALS} consecutive trials`, async () => {
    const fixture = await createTestZone(1);
    try {
      for (let trial = 0; trial < TRIALS; trial++) {
        const results = await Promise.all(
          Array.from({ length: CONCURRENT_ATTEMPTS }, () =>
            createHold({ zoneId: fixture.zoneId, userId: randomUUID(), holdDurationMs: 60_000 }),
          ),
        );

        const successes = results.filter((r) => r.ok);
        const conflicts = results.filter((r) => !r.ok);

        expect(successes, `trial ${trial}: successes`).toHaveLength(1);
        expect(conflicts, `trial ${trial}: conflicts`).toHaveLength(CONCURRENT_ATTEMPTS - 1);
        expect(conflicts.every((r) => !r.ok && r.reason === "CONFLICT")).toBe(true);
        expect(await getZoneHeldCount(fixture.zoneId), `trial ${trial}: held_count`).toBe(1);

        await resetZoneReservations(fixture.zoneId);
      }
    } finally {
      await cleanupTestZone(fixture);
    }
  }, 300_000);
});
