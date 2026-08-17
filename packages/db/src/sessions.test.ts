import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHold } from "./reservations";
import { endSessionForVehicle, startSession } from "./sessions";
import {
  cleanupTestZone,
  countEvents,
  createTestSpots,
  createTestVehicle,
  createTestZone,
  deleteTestVehicle,
  getSpotStatus,
  getZoneCounts,
  type TestZoneFixture,
} from "./test/fixtures";

// Several of these tests chain 5-7 round trips against a real database
// (createTestZone, createTestSpots, startSession, endSessionForVehicle,
// ...); over a network connection to Supabase rather than localhost,
// that occasionally exceeds vitest's 5s default.
vi.setConfig({ testTimeout: 20_000 });

let fixture: TestZoneFixture | undefined;
let otherFixture: TestZoneFixture | undefined;
let vehicleIds: string[] = [];

afterEach(async () => {
  for (const vehicleId of vehicleIds) {
    await deleteTestVehicle(vehicleId);
  }
  vehicleIds = [];
  if (fixture) {
    await cleanupTestZone(fixture);
    fixture = undefined;
  }
  if (otherFixture) {
    await cleanupTestZone(otherFixture);
    otherFixture = undefined;
  }
});

async function vehicle(): Promise<string> {
  const id = await createTestVehicle();
  vehicleIds.push(id);
  return id;
}

describe("startSession (D4/D5/D9, Phase 4)", () => {
  it("walk-up: occupies the only available spot and increments occupied_count", async () => {
    fixture = await createTestZone(1);
    const [spotId] = await createTestSpots(fixture.zoneId, 1);
    const carId = await vehicle();

    const result = await startSession({ facilityId: fixture.facilityId, vehicleId: carId });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.spotId).toBe(spotId);
    expect(await getSpotStatus(spotId)).toBe("OCCUPIED");
    expect(await getZoneCounts(fixture.zoneId)).toEqual({ heldCount: 0, occupiedCount: 1 });
    expect(await countEvents(fixture.facilityId, "session.started")).toBe(1);
  });

  it("walk-up: NO_AVAILABLE_SPOT when every spot is already occupied", async () => {
    fixture = await createTestZone(1);
    await createTestSpots(fixture.zoneId, 1);
    await startSession({ facilityId: fixture.facilityId, vehicleId: await vehicle() });

    const result = await startSession({ facilityId: fixture.facilityId, vehicleId: await vehicle() });

    expect(result).toEqual({ ok: false, reason: "NO_AVAILABLE_SPOT" });
  });

  it("walk-up: NO_CAPACITY when a spot is physically free but a hold has already claimed the zone's capacity", async () => {
    fixture = await createTestZone(1);
    await createTestSpots(fixture.zoneId, 1);
    await createHold({ zoneId: fixture.zoneId, userId: randomUUID() });

    const result = await startSession({ facilityId: fixture.facilityId, vehicleId: await vehicle() });

    expect(result).toEqual({ ok: false, reason: "NO_CAPACITY" });
  });

  it("converts a HELD reservation: reservation CONVERTED, held_count/occupied_count swap by one", async () => {
    fixture = await createTestZone(1);
    const [spotId] = await createTestSpots(fixture.zoneId, 1);
    const hold = await createHold({ zoneId: fixture.zoneId, userId: randomUUID() });
    if (!hold.ok) throw new Error("expected hold to succeed");

    const result = await startSession({
      facilityId: fixture.facilityId,
      vehicleId: await vehicle(),
      reservationId: hold.reservationId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.spotId).toBe(spotId);
    expect(await getZoneCounts(fixture.zoneId)).toEqual({ heldCount: 0, occupiedCount: 1 });
  });

  it("rejects an expired/unknown reservationId with RESERVATION_NOT_AVAILABLE", async () => {
    fixture = await createTestZone(1);
    await createTestSpots(fixture.zoneId, 1);

    const result = await startSession({
      facilityId: fixture.facilityId,
      vehicleId: await vehicle(),
      reservationId: randomUUID(),
    });

    expect(result).toEqual({ ok: false, reason: "RESERVATION_NOT_AVAILABLE" });
  });

  it("rejects a vehicle that already has an ACTIVE session with VEHICLE_ALREADY_PARKED", async () => {
    fixture = await createTestZone(2);
    await createTestSpots(fixture.zoneId, 2);
    const carId = await vehicle();
    await startSession({ facilityId: fixture.facilityId, vehicleId: carId });

    const result = await startSession({ facilityId: fixture.facilityId, vehicleId: carId });

    expect(result).toEqual({ ok: false, reason: "VEHICLE_ALREADY_PARKED" });
  });
});

describe("endSessionForVehicle (D5, Phase 4)", () => {
  it("ends the session, frees the spot, and decrements occupied_count", async () => {
    fixture = await createTestZone(1);
    const [spotId] = await createTestSpots(fixture.zoneId, 1);
    const carId = await vehicle();
    await startSession({ facilityId: fixture.facilityId, vehicleId: carId });

    const result = await endSessionForVehicle(carId, fixture.facilityId);

    expect(result).toEqual({ ok: true });
    expect(await getSpotStatus(spotId)).toBe("AVAILABLE");
    expect(await getZoneCounts(fixture.zoneId)).toEqual({ heldCount: 0, occupiedCount: 0 });
    expect(await countEvents(fixture.facilityId, "session.ended")).toBe(1);
  });

  it("reports NOT_FOUND for a vehicle with no active session", async () => {
    const result = await endSessionForVehicle(randomUUID(), randomUUID());
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("reports WRONG_FACILITY when the session belongs to a different facility", async () => {
    fixture = await createTestZone(1);
    await createTestSpots(fixture.zoneId, 1);
    otherFixture = await createTestZone(1);
    const carId = await vehicle();
    await startSession({ facilityId: fixture.facilityId, vehicleId: carId });

    const result = await endSessionForVehicle(carId, otherFixture.facilityId);

    expect(result).toEqual({ ok: false, reason: "WRONG_FACILITY" });
  });

  it("a freed spot is available for the next walk-up", async () => {
    fixture = await createTestZone(1);
    await createTestSpots(fixture.zoneId, 1);
    const first = await vehicle();
    await startSession({ facilityId: fixture.facilityId, vehicleId: first });
    await endSessionForVehicle(first, fixture.facilityId);

    const result = await startSession({ facilityId: fixture.facilityId, vehicleId: await vehicle() });

    expect(result.ok).toBe(true);
  });
});
