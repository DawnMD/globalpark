import { describe, expect, it } from "vitest";
import { SESSION_EVENTS, SESSION_STATUSES, transitionSession } from "./session-state-machine";

// Exhaustive over the full (state x event) product: ACTIVE is the only
// state with any outgoing transition, ENDED rejects everything.
const EXPECTED: Record<string, string | null> = {
  "ACTIVE:end": "ENDED",
  "ENDED:end": null,
};

describe("transitionSession (D4/D5, Phase 4)", () => {
  for (const status of SESSION_STATUSES) {
    for (const event of SESSION_EVENTS) {
      const expected = EXPECTED[`${status}:${event}`];

      it(`${status} --${event}--> ${expected ?? "rejected"}`, () => {
        const result = transitionSession(status, event);
        if (expected === null) {
          expect(result.ok).toBe(false);
        } else {
          expect(result).toEqual({ ok: true, status: expected });
        }
      });
    }
  }

  it("covers every state x event combination (guards the table above against drift)", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(SESSION_STATUSES.length * SESSION_EVENTS.length);
  });

  it("ENDED is terminal", () => {
    expect(transitionSession("ENDED", "end").ok).toBe(false);
  });
});
