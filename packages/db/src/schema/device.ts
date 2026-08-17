import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { facility } from "./facility";

export const deviceKindEnum = pgEnum("device_kind", ["TERMINAL", "SENSOR", "GATE"]);

// Devices authenticate with operator-issued long-lived tokens (D16),
// not user sessions -- they're infrastructure, not people. Only a hash
// of the token is stored.
export const device = pgTable("device", {
  id: uuid("id").primaryKey().defaultRandom(),
  facilityId: uuid("facility_id")
    .notNull()
    .references(() => facility.id),
  kind: deviceKindEnum("kind").notNull(),
  tokenHash: text("token_hash").notNull(),
  // Populated starting Phase 7 (heartbeats, stale-device alerts).
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
