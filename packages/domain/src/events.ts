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

/** Phase 4: session lifecycle, written by the gate's startSession/endSession. */
export const SESSION_EVENT_KINDS = {
  STARTED: "session.started",
  ENDED: "session.ended",
} as const;
export type SessionEventKind = (typeof SESSION_EVENT_KINDS)[keyof typeof SESSION_EVENT_KINDS];

/**
 * D5: raw spot transitions written by sensor/gate devices independent
 * of the session lifecycle above -- a sensor confirming occupancy or
 * reporting a fault doesn't necessarily know about a session. Named
 * after the SpotEvent vocabulary in spot-state-machine.ts.
 */
export const SPOT_EVENT_KINDS = {
  OCCUPY: "spot.occupy",
  RELEASE: "spot.release",
  BLOCK: "spot.block",
  UNBLOCK: "spot.unblock",
  FAULT: "spot.fault",
  REPAIR: "spot.repair",
} as const;
export type SpotEventKind = (typeof SPOT_EVENT_KINDS)[keyof typeof SPOT_EVENT_KINDS];
