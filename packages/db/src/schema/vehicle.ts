import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Vehicles are network-level, not operator-scoped (D12): a car can park
// at facilities run by different operators, so this table lives outside
// the tenancy boundary along with reservation and parking_session.
export const vehicle = pgTable("vehicle", {
  id: uuid("id").primaryKey().defaultRandom(),
  licensePlate: text("license_plate").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
