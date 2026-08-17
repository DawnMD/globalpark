import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// D12: operator_id is the tenancy column. Everything facility-scoped
// hangs off this table.
export const operator = pgTable("operator", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
