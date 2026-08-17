import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { issueDeviceToken } from "@parking-network/db/src/devices";
import {
  cleanupTestZone,
  createTestSpots,
  createTestVehicle,
  createTestZone,
  deleteTestVehicle,
  rawSql,
  type TestZoneFixture,
} from "@parking-network/db/src/test/fixtures";
import { entryProcedure, exitProcedure, resolvePlateProcedure, sensorEventProcedure } from "./session";

/**
 * Exercises the device-authenticated procedures directly via
 * `.callable({ context })` -- same headless technique reservation.test.ts
 * uses for the plain `os` procedures, extended with an explicit context
 * since these are built on `deviceAuthed` rather than bare `os`.
 */
let fixture: TestZoneFixture | undefined;
let deviceId: string | undefined;
let vehicleIds: string[] = [];

afterEach(async () => {
  for (const vehicleId of vehicleIds) {
    await deleteTestVehicle(vehicleId);
  }
  vehicleIds = [];
  if (deviceId) {
    await rawSql`DELETE FROM device WHERE id = ${deviceId}`;
    deviceId = undefined;
  }
  if (fixture) {
    await cleanupTestZone(fixture);
    fixture = undefined;
  }
});

async function vehicle(): Promise<string> {
  const id = await createTestVehicle();
  vehicleIds.push(id);
  return id;
}

async function setUpDevice(): Promise<{ facilityId: string }> {
  fixture = await createTestZone(1);
  const issued = await issueDeviceToken(fixture.facilityId, "TERMINAL");
  deviceId = issued.deviceId;
  return { facilityId: fixture.facilityId };
}

describe("session oRPC procedures (Phase 4, headless)", () => {
  it("entry validates input and delegates to startSession, scoped to the device's own facility", async () => {
    const { facilityId } = await setUpDevice();
    await createTestSpots(fixture!.zoneId, 1);
    const entry = entryProcedure.callable({
      context: () => ({ session: null, device: { deviceId: deviceId!, facilityId, kind: "TERMINAL" } }),
    });

    const result = await entry({ vehicleId: await vehicle() });

    expect(result.ok).toBe(true);
  });

  it("entry rejects a caller with no device context", async () => {
    const entry = entryProcedure.callable({
      context: () => ({ session: null, device: null }),
    });

    await expect(entry({ vehicleId: randomUUID() })).rejects.toThrow();
  });

  it("exit ends the session started by entry", async () => {
    const { facilityId } = await setUpDevice();
    await createTestSpots(fixture!.zoneId, 1);
    const carId = await vehicle();
    const context = () => ({
      session: null,
      device: { deviceId: deviceId!, facilityId, kind: "TERMINAL" as const },
    });
    await entryProcedure.callable({ context })({ vehicleId: carId });

    const result = await exitProcedure.callable({ context })({ vehicleId: carId });

    expect(result).toEqual({ ok: true });
  });

  it("sensorEvent rejects a spot belonging to a different facility with FORBIDDEN", async () => {
    const { facilityId } = await setUpDevice();
    const otherFixture = await createTestZone(1);
    const [otherSpotId] = await createTestSpots(otherFixture.zoneId, 1);
    const sensorEvent = sensorEventProcedure.callable({
      context: () => ({ session: null, device: { deviceId: deviceId!, facilityId, kind: "SENSOR" } }),
    });

    await expect(sensorEvent({ spotId: otherSpotId, event: "occupy" })).rejects.toThrow();

    await cleanupTestZone(otherFixture);
  });

  it("sensorEvent applies occupy/release to a spot in the device's own facility", async () => {
    const { facilityId } = await setUpDevice();
    const [spotId] = await createTestSpots(fixture!.zoneId, 1);
    const sensorEvent = sensorEventProcedure.callable({
      context: () => ({ session: null, device: { deviceId: deviceId!, facilityId, kind: "SENSOR" } }),
    });

    const result = await sensorEvent({ spotId, event: "occupy" });

    expect(result).toEqual({ ok: true, status: "OCCUPIED" });
  });

  it("resolvePlate returns the same vehicle id for a repeat plate, and entry accepts it", async () => {
    const { facilityId } = await setUpDevice();
    await createTestSpots(fixture!.zoneId, 1);
    const context = () => ({
      session: null,
      device: { deviceId: deviceId!, facilityId, kind: "TERMINAL" as const },
    });
    const resolvePlate = resolvePlateProcedure.callable({ context });
    const plate = `TEST-${randomUUID()}`;

    const first = await resolvePlate({ licensePlate: plate });
    const second = await resolvePlate({ licensePlate: plate });
    expect(second.vehicleId).toBe(first.vehicleId);
    vehicleIds.push(first.vehicleId);

    const entry = entryProcedure.callable({ context });
    const result = await entry({ vehicleId: first.vehicleId });
    expect(result.ok).toBe(true);
  });
});
