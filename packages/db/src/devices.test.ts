import { afterEach, describe, expect, it } from "vitest";
import { issueDeviceToken, verifyDeviceToken } from "./devices";
import { cleanupTestZone, createTestZone, rawSql, type TestZoneFixture } from "./test/fixtures";

let fixture: TestZoneFixture | undefined;

afterEach(async () => {
  if (fixture) {
    await rawSql`DELETE FROM device WHERE facility_id = ${fixture.facilityId}`;
    await cleanupTestZone(fixture);
    fixture = undefined;
  }
});

describe("issueDeviceToken / verifyDeviceToken (D16)", () => {
  it("issues a token that verifies back to the same device", async () => {
    fixture = await createTestZone(1);

    const issued = await issueDeviceToken(fixture.facilityId, "TERMINAL");
    const verified = await verifyDeviceToken(issued.token);

    expect(verified).toEqual({
      deviceId: issued.deviceId,
      facilityId: fixture.facilityId,
      kind: "TERMINAL",
    });
  });

  it("rejects an unknown token", async () => {
    const verified = await verifyDeviceToken("not-a-real-token");
    expect(verified).toBeNull();
  });

  it("records last_seen_at on a successful verify", async () => {
    fixture = await createTestZone(1);
    const issued = await issueDeviceToken(fixture.facilityId, "GATE");

    await verifyDeviceToken(issued.token);

    const [row] = await rawSql`SELECT last_seen_at FROM device WHERE id = ${issued.deviceId}`;
    expect(row.last_seen_at).not.toBeNull();
  });
});
