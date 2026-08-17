import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { operator } from "./operator.js";
import { geographyPoint } from "./types.js";

export const facility = pgTable("facility", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id")
    .notNull()
    .references(() => operator.id),
  name: text("name").notNull(),
  // Nullable until Phase 6 seeds real coordinates; ST_DWithin discovery
  // queries land then, but the column and PostGIS extension are here
  // from day one (D1).
  location: geographyPoint("location"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
