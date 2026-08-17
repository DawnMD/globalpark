import { describe, expect, it } from "vitest";
import { SPOT_EVENTS, SPOT_STATUSES, transitionSpot } from "./spot-state-machine";

// Exhaustive over the full (state x event) Cartesian product from D5's
// diagram -- every one of the 24 combinations is asserted explicitly,
// not just the happy paths.
const EXPECTED: Record<string, string | null> = {
  "AVAILABLE:occupy": "OCCUPIED",
  "AVAILABLE:release": null,
  "AVAILABLE:block": "BLOCKED",
  "AVAILABLE:unblock": null,
  "AVAILABLE:fault": "OUT_OF_SERVICE",
  "AVAILABLE:repair": null,

  "OCCUPIED:occupy": null,
  "OCCUPIED:release": "AVAILABLE",
  "OCCUPIED:block": null,
  "OCCUPIED:unblock": null,
  "OCCUPIED:fault": "OUT_OF_SERVICE",
  "OCCUPIED:repair": null,

  "BLOCKED:occupy": null,
  "BLOCKED:release": null,
  "BLOCKED:block": null,
  "BLOCKED:unblock": "AVAILABLE",
  "BLOCKED:fault": "OUT_OF_SERVICE",
  "BLOCKED:repair": null,

  "OUT_OF_SERVICE:occupy": null,
  "OUT_OF_SERVICE:release": null,
  "OUT_OF_SERVICE:block": null,
  "OUT_OF_SERVICE:unblock": null,
  "OUT_OF_SERVICE:fault": "OUT_OF_SERVICE",
  "OUT_OF_SERVICE:repair": "AVAILABLE",
};

describe("transitionSpot (D5)", () => {
  for (const status of SPOT_STATUSES) {
    for (const event of SPOT_EVENTS) {
      const expected = EXPECTED[`${status}:${event}`];

      it(`${status} --${event}--> ${expected ?? "rejected"}`, () => {
        const result = transitionSpot(status, event);
        if (expected === null) {
          expect(result.ok).toBe(false);
        } else {
          expect(result).toEqual({ ok: true, status: expected });
        }
      });
    }
  }

  it("covers every state x event combination (guards the table above against drift)", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(SPOT_STATUSES.length * SPOT_EVENTS.length);
  });
});
