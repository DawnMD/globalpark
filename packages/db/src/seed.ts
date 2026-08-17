import postgres from "postgres";

/**
 * Phase 1 seed: 1 operator, 1 facility, 3 floors, 6 zones (2 per
 * floor), 120 spots (20 per zone). Idempotent -- truncates and
 * re-inserts rather than requiring a clean database.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see .env.example)`);
  return value;
}

const FLOORS_PER_FACILITY = 3;
const ZONES_PER_FLOOR = 2;
const SPOTS_PER_ZONE = 20;

const sql = postgres(requireEnv("DATABASE_URL_SESSION"), { prepare: false });

async function main() {
  await sql.begin(async (tx) => {
    await tx`TRUNCATE TABLE parking_event, parking_session, reservation, parking_spot, parking_zone, floor, device, facility, operator, vehicle RESTART IDENTITY CASCADE`;

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
  });

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
