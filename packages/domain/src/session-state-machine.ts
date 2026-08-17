/**
 * D4/D5/Phase 4: a session is the physical occupancy of one spot by
 * one vehicle, started at the gate (walk-up, or converting a HELD
 * reservation) and ended when the vehicle leaves. ACTIVE is the only
 * non-terminal state -- ENDED is never re-entered, matching D8's
 * partial unique indexes (`one_active_session_per_spot`,
 * `one_active_session_per_vehicle`), which only ever match ACTIVE rows.
 *
 * Like the spot and reservation state machines, this is documentation
 * and a UX guardrail (D8); the database's unique indexes are the
 * actual guarantee.
 */
export const SESSION_STATUSES = ["ACTIVE", "ENDED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_EVENTS = ["end"] as const;
export type SessionEvent = (typeof SESSION_EVENTS)[number];

export type SessionTransitionResult =
  { ok: true; status: SessionStatus } | { ok: false; reason: string };

const SESSION_TRANSITIONS: Record<SessionStatus, Partial<Record<SessionEvent, SessionStatus>>> = {
  ACTIVE: { end: "ENDED" },
  ENDED: {},
};

export function transitionSession(
  current: SessionStatus,
  event: SessionEvent,
): SessionTransitionResult {
  const next = SESSION_TRANSITIONS[current][event];
  if (!next) {
    return { ok: false, reason: `cannot "${event}" a session that is ${current}` };
  }
  return { ok: true, status: next };
}
