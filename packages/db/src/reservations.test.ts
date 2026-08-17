import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createHold, expireHolds, releaseHold } from "./reservations";
import {
  cleanupTestZone,
  countEvents,
  createTestZone,
  getZoneHeldCount,
  type TestZoneFixture,
} from "./test/fixtures";

let fixture: TestZoneFixture | undefined;

afterEach(async () => {
  if (fixture) {
    await cleanupTestZone(fixture);
    fixture = undefined;
  }
});

describe("createHold / releaseHold (D4, D7)", () => {
  it("holds a unit of zone capacity and writes a reservation.held event", async () => {
    fixture = await createTestZone(1);

    const result = await createHold({ zoneId: fixture.zoneId, userId: randomUUID() });

    expect(result.ok).toBe(true);
    expect(await getZoneHeldCount(fixture.zoneId)).toBe(1);
    expect(await countEvents(fixture.zoneId, "reservation.held")).toBe(1);
  });

  it("returns CONFLICT once the zone is fully held, without touching the counter", async () => {
    fixture = await createTestZone(1);
    await createHold({ zoneId: fixture.zoneId, userId: randomUUID() });

    const result = await createHold({ zoneId: fixture.zoneId, userId: randomUUID() });

    expect(result).toEqual({ ok: false, reason: "CONFLICT" });
    expect(await getZoneHeldCount(fixture.zoneId)).toBe(1);
  });

  it("releaseHold gives the capacity unit back and writes a reservation.released event", async () => {
    fixture = await createTestZone(1);
    const hold = await createHold({ zoneId: fixture.zoneId, userId: randomUUID() });
    if (!hold.ok) throw new Error("expected hold to succeed");

    const result = await releaseHold(hold.reservationId);

    expect(result).toEqual({ ok: true });
    expect(await getZoneHeldCount(fixture.zoneId)).toBe(0);
    expect(await countEvents(fixture.zoneId, "reservation.released")).toBe(1);
  });

  it("releaseHold on an unknown id reports NOT_FOUND", async () => {
    const result = await releaseHold(randomUUID());
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("releaseHold on an already-released hold reports ALREADY_CANCELLED", async () => {
    fixture = await createTestZone(1);
    const hold = await createHold({ zoneId: fixture.zoneId, userId: randomUUID() });
    if (!hold.ok) throw new Error("expected hold to succeed");
    await releaseHold(hold.reservationId);

    const result = await releaseHold(hold.reservationId);

    expect(result).toEqual({ ok: false, reason: "ALREADY_CANCELLED" });
  });
});

describe("D6: hold expiry under a clock jumped forward mid-transaction", () => {
  it("a hold whose TTL has passed is neither cancellable nor counted, once something reads it", async () => {
    fixture = await createTestZone(1);
    const hold = await createHold({
      zoneId: fixture.zoneId,
      userId: randomUUID(),
      holdDurationMs: 1000,
    });
    if (!hold.ok) throw new Error("expected hold to succeed");

    // Sweeper hasn't run yet: the counter still reflects the hold
    // exactly as D6 says it must ("lazy alone leaves the counter
    // wrong; the sweeper alone leaves a race window") -- a second
    // createHold correctly still sees the zone as full here.
    expect(await getZoneHeldCount(fixture.zoneId)).toBe(1);
    const secondAttemptBeforeExpiry = await createHold({
      zoneId: fixture.zoneId,
      userId: randomUUID(),
    });
    expect(secondAttemptBeforeExpiry).toEqual({ ok: false, reason: "CONFLICT" });

    // The clock jumps forward past held_until with no sweep having
    // run in between.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // releaseHold is the first thing to touch the stale row. Lazy
    // expiry on read means it reports EXPIRED (not a stale success)
    // and corrects the counter in the same transaction, rather than
    // waiting for pg_cron's next scheduled tick.
    const releaseResult = await releaseHold(hold.reservationId);
    expect(releaseResult).toEqual({ ok: false, reason: "EXPIRED" });
    expect(await getZoneHeldCount(fixture.zoneId)).toBe(0);
    expect(await countEvents(fixture.zoneId, "reservation.expired")).toBe(1);

    // Capacity is available again for a new hold.
    const thirdAttempt = await createHold({ zoneId: fixture.zoneId, userId: randomUUID() });
    expect(thirdAttempt.ok).toBe(true);
  }, 10_000);

  it("expireHolds() (the same function pg_cron schedules) sweeps a stale hold directly", async () => {
    fixture = await createTestZone(1);
    await createHold({ zoneId: fixture.zoneId, userId: randomUUID(), holdDurationMs: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const { expiredCount } = await expireHolds();

    expect(expiredCount).toBeGreaterThanOrEqual(1);
    expect(await getZoneHeldCount(fixture.zoneId)).toBe(0);
    expect(await countEvents(fixture.zoneId, "reservation.expired")).toBe(1);
  }, 10_000);
});
