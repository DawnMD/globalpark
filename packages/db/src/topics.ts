import { eq } from "drizzle-orm";
import { db } from "./client";
import { floor, parkingZone } from "./schema";

/**
 * D3's SSE route is topic-scoped per facility (an operator dashboard
 * watches a whole facility, not one zone), so every parking_event any
 * write-path inserts carries a `facility:<id>` topic -- resolved via
 * zone -> floor -> facility, the same tenancy chain D12 already uses.
 * Shared by reservations.ts and sessions.ts so both write paths agree
 * on the topic a given zone resolves to.
 */
export async function resolveFacilityTopic(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  zoneId: string,
): Promise<string> {
  const [row] = await tx
    .select({ facilityId: floor.facilityId })
    .from(parkingZone)
    .innerJoin(floor, eq(parkingZone.floorId, floor.id))
    .where(eq(parkingZone.id, zoneId));
  return `facility:${row.facilityId}`;
}
