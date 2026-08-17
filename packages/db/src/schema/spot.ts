import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { parkingZone } from "./zone.js";

// D5: physical occupancy only. RESERVED is deliberately not a spot
// state -- reservations hold zone capacity (D4), not a specific spot.
export const spotStatusEnum = pgEnum("spot_status", [
  "AVAILABLE",
  "OCCUPIED",
  "BLOCKED",
  "OUT_OF_SERVICE",
]);

// Named parking_spot (not "spot") to match D5's literal references.
// Written only by terminal/sensor events -- never by the reservation
// flow (enforced by convention now, by application boundaries from
// Phase 4 onward).
export const parkingSpot = pgTable("parking_spot", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => parkingZone.id),
  label: text("label").notNull(),
  status: spotStatusEnum("status").notNull().default("AVAILABLE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
