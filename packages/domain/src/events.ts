/**
 * D7: `parking_event.kind` values. Defined once here so the string a
 * transactional function writes and the string a test or SSE consumer
 * filters on can never drift apart.
 */
export const RESERVATION_EVENT_KINDS = {
  HELD: "reservation.held",
  RELEASED: "reservation.released",
  EXPIRED: "reservation.expired",
} as const;
export type ReservationEventKind =
  (typeof RESERVATION_EVENT_KINDS)[keyof typeof RESERVATION_EVENT_KINDS];
