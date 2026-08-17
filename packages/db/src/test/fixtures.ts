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

export async function countEvents(zoneId: string, kind: string): Promise<number> {
  const [row] = await rawSql`
    SELECT count(*)::int AS count FROM parking_event
    WHERE topic = ${`zone:${zoneId}`} AND kind = ${kind}
  `;
  return row.count;
}
