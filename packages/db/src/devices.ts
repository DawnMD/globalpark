import { randomBytes, createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { device } from "./schema";

export type DeviceKind = "TERMINAL" | "SENSOR" | "GATE";

/**
 * D16: devices (terminals, sensors, gates) authenticate with
 * operator-issued long-lived tokens, not user sessions -- they're
 * infrastructure, not people. Only a SHA-256 hash of the token is
 * stored (same reasoning as a password hash: a stolen database row
 * shouldn't hand out a working credential), so the plaintext token is
 * returned exactly once, at issuance.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type IssueDeviceTokenResult = {
  deviceId: string;
  token: string;
};

export async function issueDeviceToken(
  facilityId: string,
  kind: DeviceKind,
): Promise<IssueDeviceTokenResult> {
  const token = randomBytes(32).toString("hex");

  const [row] = await db
    .insert(device)
    .values({ facilityId, kind, tokenHash: hashToken(token) })
    .returning({ id: device.id });

  return { deviceId: row.id, token };
}

export type VerifiedDevice = {
  deviceId: string;
  facilityId: string;
  kind: DeviceKind;
};

/**
 * Called on every device-authenticated request (Phase 4's oRPC route,
 * see packages/api's deviceAuthed middleware). Also bumps
 * `last_seen_at` -- stubbed until Phase 7's stale-device alerts
 * actually read it, but there's no reason to wait until then to start
 * recording it.
 */
export async function verifyDeviceToken(token: string): Promise<VerifiedDevice | null> {
  const [row] = await db
    .update(device)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(device.tokenHash, hashToken(token)))
    .returning({ id: device.id, facilityId: device.facilityId, kind: device.kind });

  if (!row) return null;
  return { deviceId: row.id, facilityId: row.facilityId, kind: row.kind };
}
