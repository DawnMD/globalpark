import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createHold, releaseHold } from "./reservations";
import { cleanupTestZone, countEvents, createTestZone, getZoneHeldCount } from "./test/fixtures";

/**
 * D6/D7: zone counters are a denormalized value maintained alongside
 * the append-only event log, not derived from it -- Part 3 of the plan
 * leaves open whether that's the right call, deferring to exactly this
 * test. held_count reconstructed from the event log (holds minus
 * releases minus expiries) must equal the counter column under any
 * order of operations, property-tested rather than a handful of
 * hand-picked sequences.
 *
 * Capacity is generous (1000) so CONFLICTs are not the thing under
 * test here -- D15 already covers contention at the capacity boundary.
 */
describe("D6/D7: zone counter matches the event log it was derived from", () => {
  it("reconstructing held_count from parking_event matches the counter column under random operation sequences", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<"hold" | "release">("hold", "release"), {
          minLength: 1,
          maxLength: 30,
        }),
        async (ops) => {
          const fixture = await createTestZone(1000);
          try {
            const heldIds: string[] = [];

            for (const op of ops) {
              if (op === "hold") {
                const result = await createHold({
                  zoneId: fixture.zoneId,
                  userId: randomUUID(),
                  holdDurationMs: 60_000,
                });
                if (result.ok) heldIds.push(result.reservationId);
              } else if (heldIds.length > 0) {
                const id = heldIds.pop();
                if (id) await releaseHold(id);
              }
            }

            const [heldCount, heldEvents, releasedEvents, expiredEvents] = await Promise.all([
              getZoneHeldCount(fixture.zoneId),
              countEvents(fixture.facilityId, "reservation.held"),
              countEvents(fixture.facilityId, "reservation.released"),
              countEvents(fixture.facilityId, "reservation.expired"),
            ]);

            const reconstructed = heldEvents - releasedEvents - expiredEvents;
            expect(reconstructed).toBe(heldCount);
          } finally {
            await cleanupTestZone(fixture);
          }
        },
      ),
      { numRuns: 15 },
    );
  }, 120_000);
});
