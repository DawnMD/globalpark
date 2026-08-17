import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { parkingZone } from "./zone";
import { vehicle } from "./vehicle";

// HELD -> CONVERTED (a session starts) or EXPIRED (D6) or CANCELLED.
export const reservationStatusEnum = pgEnum("reservation_status", [
  "HELD",
  "EXPIRED",
  "CANCELLED",
  "CONVERTED",
]);

export const reservation = pgTable("reservation", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => parkingZone.id),
  // No FK yet: Better Auth's user table arrives in Phase 3. Users are
  // network-level citizens, not operator tenants (D12) -- this column
  // will reference auth state, never operator-scoped state.
  userId: uuid("user_id").notNull(),
  vehicleId: uuid("vehicle_id").references(() => vehicle.id),
  status: reservationStatusEnum("status").notNull().default("HELD"),
  // D6: every hold carries an expiry. Treated as expired on read
  // wherever it's checked (held_until < now()), plus a pg_cron sweeper
  // that decrements the zone counter and writes reservation.expired.
  heldUntil: timestamp("held_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
