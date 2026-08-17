/**
 * D4/D6: a reservation holds zone capacity, not a spot. HELD is the
 * only non-terminal state; EXPIRED (D6 sweeper or lazy-expiry-on-read),
 * CANCELLED (user-initiated release), and CONVERTED (a session starts,
 * Phase 4) are all terminal -- once left, HELD is never re-entered.
 *
 * Like the spot state machine, this is documentation and a UX
 * guardrail (D8); the database's partial unique indexes and CHECK
 * constraint are the actual guarantee.
 */
export const RESERVATION_STATUSES = ["HELD", "EXPIRED", "CANCELLED", "CONVERTED"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_EVENTS = ["expire", "cancel", "convert"] as const;
export type ReservationEvent = (typeof RESERVATION_EVENTS)[number];

export type ReservationTransitionResult =
  { ok: true; status: ReservationStatus } | { ok: false; reason: string };

const RESERVATION_TRANSITIONS: Record<
  ReservationStatus,
  Partial<Record<ReservationEvent, ReservationStatus>>
> = {
  HELD: { expire: "EXPIRED", cancel: "CANCELLED", convert: "CONVERTED" },
  EXPIRED: {},
  CANCELLED: {},
  CONVERTED: {},
};

export function transitionReservation(
  current: ReservationStatus,
  event: ReservationEvent,
): ReservationTransitionResult {
  const next = RESERVATION_TRANSITIONS[current][event];
  if (!next) {
    return { ok: false, reason: `cannot "${event}" a reservation that is ${current}` };
  }
  return { ok: true, status: next };
}
