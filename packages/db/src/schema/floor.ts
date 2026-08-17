import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { facility } from "./facility.js";

export const floor = pgTable("floor", {
  id: uuid("id").primaryKey().defaultRandom(),
  facilityId: uuid("facility_id")
    .notNull()
    .references(() => facility.id),
  name: text("name").notNull(),
  level: integer("level").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
