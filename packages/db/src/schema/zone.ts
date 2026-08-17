import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { floor } from "./floor.js";

// Named parking_zone (not "zone") to match the literal SQL in D4/D8 --
// the capacity-hold UPDATE and the CHECK constraint reference this name.
export const parkingZone = pgTable(
  "parking_zone",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    floorId: uuid("floor_id")
      .notNull()
      .references(() => floor.id),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    // Reservations hold capacity here (D4); this is not derived from
    // spot rows, it's the counter the capacity-hold UPDATE contends on.
    heldCount: integer("held_count").notNull().default(0),
    occupiedCount: integer("occupied_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // D4/D8: capacity can never be oversold. This is the invariant the
    // 200-way adversarial test (D15, Phase 2) is written against.
    check(
      "capacity_not_exceeded",
      sql`${table.heldCount} + ${table.occupiedCount} <= ${table.capacity}`,
    ),
    check("counts_not_negative", sql`${table.heldCount} >= 0 AND ${table.occupiedCount} >= 0`),
  ],
);
