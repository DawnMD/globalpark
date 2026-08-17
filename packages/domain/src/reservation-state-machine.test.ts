import { describe, expect, it } from "vitest";
import {
  RESERVATION_EVENTS,
  RESERVATION_STATUSES,
  transitionReservation,
} from "./reservation-state-machine";

// Exhaustive over the full (state x event) product: HELD is the only
// state with any outgoing transition, every terminal state rejects
// every event.
const EXPECTED: Record<string, string | null> = {
  "HELD:expire": "EXPIRED",
  "HELD:cancel": "CANCELLED",
  "HELD:convert": "CONVERTED",

  "EXPIRED:expire": null,
  "EXPIRED:cancel": null,
  "EXPIRED:convert": null,

  "CANCELLED:expire": null,
  "CANCELLED:cancel": null,
  "CANCELLED:convert": null,

  "CONVERTED:expire": null,
  "CONVERTED:cancel": null,
  "CONVERTED:convert": null,
};

describe("transitionReservation (D4/D6)", () => {
  for (const status of RESERVATION_STATUSES) {
    for (const event of RESERVATION_EVENTS) {
      const expected = EXPECTED[`${status}:${event}`];

      it(`${status} --${event}--> ${expected ?? "rejected"}`, () => {
        const result = transitionReservation(status, event);
        if (expected === null) {
          expect(result.ok).toBe(false);
        } else {
          expect(result).toEqual({ ok: true, status: expected });
        }
      });
    }
  }

  it("covers every state x event combination (guards the table above against drift)", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(
      RESERVATION_STATUSES.length * RESERVATION_EVENTS.length,
    );
  });

  it("HELD is the only state with any outgoing transition", () => {
    for (const status of RESERVATION_STATUSES) {
      if (status === "HELD") continue;
      for (const event of RESERVATION_EVENTS) {
        expect(transitionReservation(status, event).ok).toBe(false);
      }
    }
  });
});
