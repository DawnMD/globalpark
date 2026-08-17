import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { env } from "../env";

/**
 * Session-mode connection for test setup/teardown -- these run a
 * handful of statements each, not the pooled query volume the
 * transaction-pooled `db` client is designed for.
 */
export const rawSql = postgres(env.DATABASE_URL_SESSION, { prepare: false });

export type TestZoneFixture = {
  operatorId: string;
  facilityId: string;
  floorId: string;
  zoneId: string;
};

export async function createTestZone(capacity: number): Promise<TestZoneFixture> {
  const [operator] =
    await rawSql`INSERT INTO operator (name) VALUES ('Phase 2 Test Operator') RETURNING id`;
  const [facility] = await rawSql`
    INSERT INTO facility (operator_id, name) VALUES (${operator.id}, 'Phase 2 Test Facility') RETURNING id
  `;
  const [floor] = await rawSql`
    INSERT INTO floor (facility_id, name, level) VALUES (${facility.id}, 'Ground', 0) RETURNING id
  `;
  const [zone] = await rawSql`
    INSERT INTO parking_zone (floor_id, name, capacity, held_count, occupied_count)
    VALUES (${floor.id}, 'Z', ${capacity}, 0, 0)
    RETURNING id
  `;
  return { operatorId: operator.id, facilityId: facility.id, floorId: floor.id, zoneId: zone.id };
}

/** Deletes only this fixture's reservations/events, leaving the zone counter and other rows untouched -- used between trials within a single test. */
export async function resetZoneReservations(zoneId: string): Promise<void> {
  await rawSql`
    DELETE FROM parking_event WHERE entity_id IN (SELECT id FROM reservation WHERE zone_id = ${zoneId})
  `;
  await rawSql`DELETE FROM reservation WHERE zone_id = ${zoneId}`;
  await rawSql`UPDATE parking_zone SET held_count = 0, occupied_count = 0 WHERE id = ${zoneId}`;
}

export async function cleanupTestZone(fixture: TestZoneFixture): Promise<void> {
  await resetZoneReservations(fixture.zoneId);
  await rawSql`
    DELETE FROM parking_event
    WHERE entity_id IN (
      SELECT id FROM parking_session WHERE spot_id IN (
        SELECT id FROM parking_spot WHERE zone_id = ${fixture.zoneId}
      )
    )
  `;
  await rawSql`
    DELETE FROM parking_session WHERE spot_id IN (
      SELECT id FROM parking_spot WHERE zone_id = ${fixture.zoneId}
    )
  `;
  await rawSql`DELETE FROM parking_spot WHERE zone_id = ${fixture.zoneId}`;
  await rawSql`DELETE FROM parking_zone WHERE id = ${fixture.zoneId}`;
  await rawSql`DELETE FROM floor WHERE id = ${fixture.floorId}`;
  await rawSql`DELETE FROM facility WHERE id = ${fixture.facilityId}`;
  await rawSql`DELETE FROM operator WHERE id = ${fixture.operatorId}`;
}

export async function getZoneHeldCount(zoneId: string): Promise<number> {
  const [row] = await rawSql`SELECT held_count FROM parking_zone WHERE id = ${zoneId}`;
  return row.held_count;
}

export async function getZoneCounts(
  zoneId: string,
): Promise<{ heldCount: number; occupiedCount: number }> {
  const [row] =
    await rawSql`SELECT held_count, occupied_count FROM parking_zone WHERE id = ${zoneId}`;
  return { heldCount: row.held_count, occupiedCount: row.occupied_count };
}

/** Inserts `count` AVAILABLE spots into an existing test zone, returning their ids. Cleaned up by cleanupTestZone, which already deletes by zone_id. */
export async function createTestSpots(zoneId: string, count: number): Promise<string[]> {
  const rows = await rawSql`
    INSERT INTO parking_spot (zone_id, label)
    SELECT ${zoneId}, 'S' || g FROM generate_series(1, ${count}) AS g
    RETURNING id
  `;
  return rows.map((row) => row.id);
}

export async function getSpotStatus(spotId: string): Promise<string> {
  const [row] = await rawSql`SELECT status FROM parking_spot WHERE id = ${spotId}`;
  return row.status;
}

/** Network-level, not tied to any fixture facility (D12) -- caller must delete it explicitly. */
export async function createTestVehicle(): Promise<string> {
  const [row] = await rawSql`
    INSERT INTO vehicle (license_plate) VALUES (${"TEST-" + randomUUID()}) RETURNING id
  `;
  return row.id;
}

export async function deleteTestVehicle(vehicleId: string): Promise<void> {
  await rawSql`DELETE FROM parking_session WHERE vehicle_id = ${vehicleId}`;
  await rawSql`DELETE FROM vehicle WHERE id = ${vehicleId}`;
}

export async function countEvents(facilityId: string, kind: string): Promise<number> {
  const [row] = await rawSql`
    SELECT count(*)::int AS count FROM parking_event
    WHERE topic = ${`facility:${facilityId}`} AND kind = ${kind}
  `;
  return row.count;
}
