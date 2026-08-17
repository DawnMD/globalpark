import { afterEach, describe, expect, it } from "vitest";
import { applySpotTransition } from "./spot-transitions";
import {
  cleanupTestZone,
  countEvents,
  createTestSpots,
  createTestZone,
  getSpotStatus,
  getZoneCounts,
  type TestZoneFixture,
} from "./test/fixtures";

let fixture: TestZoneFixture | undefined;

afterEach(async () => {
  if (fixture) {
    await cleanupTestZone(fixture);
    fixture = undefined;
  }
});

describe("applySpotTransition (D5, Phase 4)", () => {
  it("occupy flips AVAILABLE -> OCCUPIED and writes a spot.occupy event, leaving zone counters untouched", async () => {
    fixture = await createTestZone(1);
    const [spotId] = await createTestSpots(fixture.zoneId, 1);

    const result = await applySpotTransition(spotId, "occupy");

    expect(result).toEqual({ ok: true, status: "OCCUPIED" });
    expect(await getSpotStatus(spotId)).toBe("OCCUPIED");
    expect(await getZoneCounts(fixture.zoneId)).toEqual({ heldCount: 0, occupiedCount: 0 });
    expect(await countEvents(fixture.facilityId, "spot.occupy")).toBe(1);
  });

  it("release flips OCCUPIED -> AVAILABLE and writes a spot.release event", async () => {
    fixture = await createTestZone(1);
    const [spotId] = await createTestSpots(fixture.zoneId, 1);
    await applySpotTransition(spotId, "occupy");

    const result = await applySpotTransition(spotId, "release");

    expect(result).toEqual({ ok: true, status: "AVAILABLE" });
    expect(await countEvents(fixture.facilityId, "spot.release")).toBe(1);
  });

  it("rejects an invalid transition without writing an event", async () => {
    fixture = await createTestZone(1);
    const [spotId] = await createTestSpots(fixture.zoneId, 1);

    const result = await applySpotTransition(spotId, "release");

    expect(result.ok).toBe(false);
    expect(await getSpotStatus(spotId)).toBe("AVAILABLE");
    expect(await countEvents(fixture.facilityId, "spot.release")).toBe(0);
  });

  it("block/unblock and fault/repair round-trip through the maintenance states", async () => {
    fixture = await createTestZone(1);
    const [spotId] = await createTestSpots(fixture.zoneId, 1);

    expect(await applySpotTransition(spotId, "block")).toEqual({ ok: true, status: "BLOCKED" });
    expect(await applySpotTransition(spotId, "unblock")).toEqual({
      ok: true,
      status: "AVAILABLE",
    });
    expect(await applySpotTransition(spotId, "fault")).toEqual({
      ok: true,
      status: "OUT_OF_SERVICE",
    });
    expect(await applySpotTransition(spotId, "repair")).toEqual({
      ok: true,
      status: "AVAILABLE",
    });
  });

  it("reports a friendly reason for an unknown spot", async () => {
    const result = await applySpotTransition("00000000-0000-0000-0000-000000000000", "occupy");
    expect(result.ok).toBe(false);
  });
});
