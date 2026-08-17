import postgres from "postgres";
import { auth } from "./auth";
import { closeDb } from "./client";
import { env } from "./env";

/**
 * Phase 1 seed: 1 operator, 1 facility, 3 floors, 6 zones (2 per
 * floor), 120 spots (20 per zone). Idempotent -- truncates and
 * re-inserts rather than requiring a clean database.
 *
 * Phase 3 adds a demo operator login (DEMO_OPERATOR_EMAIL/PASSWORD
 * below), created through auth.api.signUpEmail rather than a hand-
 * rolled INSERT so the password hash matches whatever Better Auth
 * actually verifies against.
 */
const FLOORS_PER_FACILITY = 3;
const ZONES_PER_FLOOR = 2;
const SPOTS_PER_ZONE = 20;

const DEMO_OPERATOR_EMAIL = "operator@example.com";
const DEMO_OPERATOR_PASSWORD = "parking-demo-password";

const sql = postgres(env.DATABASE_URL_SESSION, { prepare: false });

async function main() {
  const { facilityId, operatorId } = await sql.begin(async (tx) => {
    await tx`TRUNCATE TABLE parking_event, parking_session, reservation, parking_spot, parking_zone, floor, device, facility, operator, vehicle, operator_member, session, account, verification, "user" RESTART IDENTITY CASCADE`;

    const [operator] = await tx`
      INSERT INTO operator (name) VALUES ('Downtown Parking Co.') RETURNING id
    `;

    const [facility] = await tx`
      INSERT INTO facility (operator_id, name)
      VALUES (${operator.id}, 'Main Street Garage')
      RETURNING id
    `;

    let zoneCount = 0;
    let spotCount = 0;

    for (let level = 0; level < FLOORS_PER_FACILITY; level++) {
      const [floor] = await tx`
        INSERT INTO floor (facility_id, name, level)
        VALUES (${facility.id}, ${`Level ${level + 1}`}, ${level})
        RETURNING id
      `;

      for (let z = 0; z < ZONES_PER_FLOOR; z++) {
        const zoneLabel = String.fromCharCode(65 + z); // A, B
        const [zone] = await tx`
          INSERT INTO parking_zone (floor_id, name, capacity, held_count, occupied_count)
          VALUES (${floor.id}, ${`${level + 1}${zoneLabel}`}, ${SPOTS_PER_ZONE}, 0, 0)
          RETURNING id
        `;
        zoneCount++;

        const spotRows = Array.from({ length: SPOTS_PER_ZONE }, (_, i) => ({
          zone_id: zone.id,
          label: `${level + 1}${zoneLabel}${String(i + 1).padStart(2, "0")}`,
        }));
        await tx`INSERT INTO parking_spot ${tx(spotRows, "zone_id", "label")}`;
        spotCount += SPOTS_PER_ZONE;
      }
    }

    console.log(
      `Seeded 1 operator, 1 facility, ${FLOORS_PER_FACILITY} floors, ${zoneCount} zones, ${spotCount} spots.`,
    );

    return { facilityId: facility.id as string, operatorId: operator.id as string };
  });

  // Outside the transaction above: auth.api.signUpEmail writes through
  // the drizzle adapter's own (transaction-pooled) connection, not the
  // raw sql.begin() one, so it can't participate in that transaction.
  const signUpResult = await auth.api.signUpEmail({
    body: { email: DEMO_OPERATOR_EMAIL, password: DEMO_OPERATOR_PASSWORD, name: "Demo Operator" },
  });

  await sql`
    INSERT INTO operator_member (operator_id, user_id) VALUES (${operatorId}, ${signUpResult.user.id})
  `;

  console.log(`Demo operator login: ${DEMO_OPERATOR_EMAIL} / ${DEMO_OPERATOR_PASSWORD}`);
  console.log(`(facility ${facilityId} is now owned by that login)`);

  await sql.end();
  // auth.api.signUpEmail pulled in packages/db's own connection pool
  // (client.ts's `db`), which stays open for a long-lived server --
  // close it explicitly or this one-shot script never exits.
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
