import { sql } from "drizzle-orm";
import { bigint, bigserial, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { device } from "./device.js";

// D7: one append-only table, appended inside the same transaction as
// the state change it records. It is simultaneously the audit trail,
// the outbox (a trigger fires NOTIFY on insert -- see the accompanying
// migration), the debugging log, the reconciliation source, and the
// future analytics feed. No separate outbox table, no message bus.
export const parkingEvent = pgTable(
  "parking_event",
  {
    // Serial, not UUID: this id is emitted as the SSE event id (D3) so
    // Last-Event-ID replay can resume from an exact point.
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // e.g. "facility:42" -- what an SSE subscriber filters on.
    topic: text("topic").notNull(),
    // e.g. "availability", "reservation.expired", "spot.reconciled".
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default({}),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    // Set only for device-originated events (D10 idempotency below).
    deviceId: uuid("device_id").references(() => device.id),
    localSeq: bigint("local_seq", { mode: "number" }),
    // D10: stored response so a retried (device_id, local_seq) returns
    // the original response instead of looking like a failure to a
    // device that will otherwise retry forever.
    responseBody: jsonb("response_body"),
    // D7: device clock (untrusted) and server clock, never mixed.
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // D10: idempotency key is (device_id, local_seq), scoped to rows
    // that actually came from a device. local_seq has no meaning
    // (and no ordering guarantee) across different devices.
    uniqueIndex("device_local_seq_idempotency")
      .on(table.deviceId, table.localSeq)
      .where(sql`${table.deviceId} IS NOT NULL`),
  ],
);
