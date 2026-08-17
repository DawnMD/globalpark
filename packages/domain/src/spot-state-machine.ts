/**
 * D5: spot state records physical occupancy only, written by
 * terminal/sensor events -- never by the reservation flow. RESERVED is
 * deliberately not a state here; a reservation holds zone capacity
 * (D4), not a concrete spot.
 *
 *   AVAILABLE --occupy--> OCCUPIED --release--> AVAILABLE
 *   AVAILABLE --block---> BLOCKED  --unblock--> AVAILABLE
 *       any   --fault---> OUT_OF_SERVICE --repair--> AVAILABLE
 *
 * This is documentation and a UX guardrail (D8) -- the database CHECK
 * and unique-index constraints are the actual guarantee, not this file.
 */
export const SPOT_STATUSES = ["AVAILABLE", "OCCUPIED", "BLOCKED", "OUT_OF_SERVICE"] as const;
export type SpotStatus = (typeof SPOT_STATUSES)[number];

export const SPOT_EVENTS = ["occupy", "release", "block", "unblock", "fault", "repair"] as const;
export type SpotEvent = (typeof SPOT_EVENTS)[number];

export type SpotTransitionResult = { ok: true; status: SpotStatus } | { ok: false; reason: string };

// "any -> fault -> OUT_OF_SERVICE" includes OUT_OF_SERVICE itself: a
// second fault report on an already-faulted spot is a no-op, not an
// error -- sensors double-report.
const SPOT_TRANSITIONS: Record<SpotStatus, Partial<Record<SpotEvent, SpotStatus>>> = {
  AVAILABLE: { occupy: "OCCUPIED", block: "BLOCKED", fault: "OUT_OF_SERVICE" },
  OCCUPIED: { release: "AVAILABLE", fault: "OUT_OF_SERVICE" },
  BLOCKED: { unblock: "AVAILABLE", fault: "OUT_OF_SERVICE" },
  OUT_OF_SERVICE: { repair: "AVAILABLE", fault: "OUT_OF_SERVICE" },
};

export function transitionSpot(current: SpotStatus, event: SpotEvent): SpotTransitionResult {
  const next = SPOT_TRANSITIONS[current][event];
  if (!next) {
    return { ok: false, reason: `cannot "${event}" a spot that is ${current}` };
  }
  return { ok: true, status: next };
}
