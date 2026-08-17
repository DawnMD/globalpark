import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { operator } from "./operator";
import { user } from "./auth";

/**
 * D12's tenant boundary made concrete for auth: a Better Auth user is
 * not itself an operator (operators are the tenant, users cross them
 * per D12's "the trap"), so this join table is what "operator-scoped
 * access" for the dashboard actually checks against. No `role`
 * distinction beyond membership yet -- YAGNI until a real need for
 * staff-vs-owner permissions shows up.
 */
export const operatorMember = pgTable(
  "operator_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operator.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("operator_member_unique").on(table.operatorId, table.userId)],
);
