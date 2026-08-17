import { db } from "./client";
import { vehicle } from "./schema";

/**
 * A terminal reads a license plate, not a vehicle id (Phase 4) -- this
 * is the idempotent upsert-by-natural-key that turns one into the
 * other, creating the vehicle on its first sighting. Vehicles are
 * network-level (D12), so there's no facility scoping here: any
 * device may resolve any plate.
 */
export async function resolveVehicleByPlate(licensePlate: string): Promise<string> {
  const [row] = await db
    .insert(vehicle)
    .values({ licensePlate })
    .onConflictDoUpdate({ target: vehicle.licensePlate, set: { licensePlate } })
    .returning({ id: vehicle.id });
  return row.id;
}
