import { sql } from "drizzle-orm";
import { pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { parkingSpot } from "./spot.js";
import { vehicle } from "./vehicle.js";
import { reservation } from "./reservation.js";

export const sessionStatusEnum = pgEnum("session_status", ["ACTIVE", "ENDED"]);

// Named parking_session to match D8's literal index DDL. reservationId
// is nullable: a walk-up session (no prior hold) is valid -- D4's
// "arrived without a hold" path, handled in Phase 4.
export const parkingSession = pgTable(
  "parking_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spotId: uuid("spot_id")
      .notNull()
      .references(() => parkingSpot.id),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicle.id),
    reservationId: uuid("reservation_id").references(() => reservation.id),
    status: sessionStatusEnum("status").notNull().default("ACTIVE"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    // D8: one active session per spot, ever, and one active session
    // per vehicle across the whole network. These two constraints are
    // the actual guarantee; the TypeScript state machine (Phase 2) is
    // documentation on top of them.
    uniqueIndex("one_active_session_per_spot")
      .on(table.spotId)
      .where(sql`${table.status} = 'ACTIVE'`),
    uniqueIndex("one_active_session_per_vehicle")
      .on(table.vehicleId)
      .where(sql`${table.status} = 'ACTIVE'`),
  ],
);
