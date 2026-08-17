import postgres from "postgres";
import { env } from "./env";

/**
 * Phase 1 exit criteria (parking-network-plan.md): "you cannot violate
 * any invariant by hand from psql. Try to, deliberately." This script
 * is that attempt, automated: oversell a zone, double-occupy a spot,
 * give a vehicle two active sessions. All three must fail at the
 * database with a legible error.
 *
 * Everything runs inside one outer transaction that is rolled back at
 * the end, so this leaves no fixture rows behind. Each attempted
 * violation runs in its own SAVEPOINT: a CHECK/unique violation aborts
 * the enclosing transaction in Postgres, so without a savepoint the
 * second and third attempts would fail for the wrong reason.
 */
const sql = postgres(env.DATABASE_URL_SESSION, { prepare: false });

async function expectFailure(
  tx: postgres.TransactionSql,
  name: string,
  run: (tx: postgres.TransactionSql) => Promise<unknown>,
): Promise<boolean> {
  try {
    await tx.savepoint((sp) => run(sp));
    console.error(`FAIL (should have been rejected): ${name}`);
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`OK (rejected as expected): ${name}\n  -> ${message.split("\n")[0]}`);
    return true;
  }
}

async function main() {
  const results: boolean[] = [];

  await sql
    .begin(async (tx) => {
      const [operator] = await tx`INSERT INTO operator (name) VALUES ('Invariant Test Operator') RETURNING id`;
      const [facility] = await tx`INSERT INTO facility (operator_id, name) VALUES (${operator.id}, 'Test Facility') RETURNING id`;
      const [floor] = await tx`INSERT INTO floor (facility_id, name, level) VALUES (${facility.id}, 'Ground', 0) RETURNING id`;
      const [zone] = await tx`INSERT INTO parking_zone (floor_id, name, capacity, held_count, occupied_count) VALUES (${floor.id}, 'Z1', 1, 0, 1) RETURNING id`;
      const [spot1] = await tx`INSERT INTO parking_spot (zone_id, label) VALUES (${zone.id}, 'A1') RETURNING id`;
      const [spot2] = await tx`INSERT INTO parking_spot (zone_id, label) VALUES (${zone.id}, 'A2') RETURNING id`;
      const [vehicle1] = await tx`INSERT INTO vehicle (license_plate) VALUES ('TEST-001') RETURNING id`;
      const [vehicle2] = await tx`INSERT INTO vehicle (license_plate) VALUES ('TEST-002') RETURNING id`;

      // D4/D8: capacity_not_exceeded. Zone is already full (capacity 1,
      // occupied 1); holding one more unit must fail the CHECK.
      results.push(
        await expectFailure(tx, "oversell a zone past capacity", (sp) =>
          sp`UPDATE parking_zone SET held_count = held_count + 1 WHERE id = ${zone.id}`,
        ),
      );

      // D8: one_active_session_per_spot. Two ACTIVE sessions on the
      // same spot must violate the partial unique index.
      await tx`INSERT INTO parking_session (spot_id, vehicle_id, status) VALUES (${spot1.id}, ${vehicle1.id}, 'ACTIVE')`;
      results.push(
        await expectFailure(tx, "double-occupy a spot with two active sessions", (sp) =>
          sp`INSERT INTO parking_session (spot_id, vehicle_id, status) VALUES (${spot1.id}, ${vehicle2.id}, 'ACTIVE')`,
        ),
      );

      // D8: one_active_session_per_vehicle. The same vehicle cannot
      // hold two ACTIVE sessions, even at a different spot.
      results.push(
        await expectFailure(tx, "give a vehicle two active sessions", (sp) =>
          sp`INSERT INTO parking_session (spot_id, vehicle_id, status) VALUES (${spot2.id}, ${vehicle1.id}, 'ACTIVE')`,
        ),
      );

      // Discard all fixture rows -- this is a probe, not seed data.
      throw new Error("__rollback_test_fixtures__");
    })
    .catch((err) => {
      if (err instanceof Error && err.message === "__rollback_test_fixtures__") return;
      throw err;
    });

  await sql.end();

  const allPassed = results.length === 3 && results.every(Boolean);
  if (!allPassed) {
    console.error("\nSome invariants were violated. Phase 1 exit criteria not met.");
    process.exit(1);
  }
  console.log("\nAll three invariants held. Phase 1 exit criteria met.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
