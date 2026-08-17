import { z } from "zod";

/**
 * D11: every facility periodically pushes a full-state snapshot --
 * "here are my 120 bays and their current states." Event replay does
 * not converge in the real world (sensors miss exits, cars tailgate
 * through gates, spots get stuck OCCUPIED with no matching exit
 * event); events give you the why, snapshots give you the truth.
 * Derived occupancy state is overwritten wholesale from this, not
 * merged (D9: physical occupancy is the facility's authority).
 *
 * Defined here in Phase 1 even though the ingest endpoint isn't called
 * until Phase 5 -- retrofitting this after the event model has
 * hardened is the expensive way to learn this lesson.
 */
export const spotSnapshotSchema = z.object({
  spotId: z.uuid(),
  status: z.enum(["AVAILABLE", "OCCUPIED", "BLOCKED", "OUT_OF_SERVICE"]),
});
export type SpotSnapshot = z.infer<typeof spotSnapshotSchema>;

export const facilitySnapshotSchema = z.object({
  facilityId: z.uuid(),
  deviceId: z.uuid(),
  generatedAt: z.iso.datetime(),
  spots: z.array(spotSnapshotSchema),
});
export type FacilitySnapshot = z.infer<typeof facilitySnapshotSchema>;

/**
 * Every snapshot-driven correction writes a `spot.reconciled` event
 * (D11), so drift between the event log and physical reality is
 * measurable rather than silent.
 */
export type SnapshotIngestResult = {
  reconciledCount: number;
  unchangedCount: number;
};

/**
 * Stubbed per the Phase 1 plan: contract defined now, implementation
 * arrives in Phase 5 alongside the reconciliation logic it depends on.
 * No HTTP route exists yet in Phase 1 -- this is the function-level
 * contract apps/web's future endpoint will call into.
 */
export async function ingestFacilitySnapshot(
  _snapshot: FacilitySnapshot,
): Promise<SnapshotIngestResult> {
  throw new Error("ingestFacilitySnapshot is not implemented until Phase 5");
}
