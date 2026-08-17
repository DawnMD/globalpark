"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc-client";
import { useTopicInvalidation } from "@/lib/use-topic-invalidation";

export function FacilityDashboard({ facilityId }: { facilityId: string }) {
  const router = useRouter();
  const topic = `facility:${facilityId}`;

  // D3 end to end: this is the one subscription that keeps both
  // queries below live. Any parking_event on this facility's topic
  // invalidates both, and they refetch.
  useTopicInvalidation(topic);

  const zonesQuery = useQuery({
    queryKey: [topic, "zones"],
    queryFn: () => orpc.facility.zones({ facilityId }),
  });

  const reservationsQuery = useQuery({
    queryKey: [topic, "reservations"],
    queryFn: () => orpc.facility.reservations({ facilityId }),
  });

  const zones = zonesQuery.data ?? [];
  const totals = zones.reduce(
    (acc, zone) => ({
      capacity: acc.capacity + zone.capacity,
      held: acc.held + zone.heldCount,
      occupied: acc.occupied + zone.occupiedCount,
    }),
    { capacity: 0, held: 0, occupied: 0 },
  );

  return (
    <main>
      <h1>Facility Occupancy</h1>
      <button
        type="button"
        onClick={() => authClient.signOut().then(() => router.push("/sign-in"))}
      >
        Sign out
      </button>

      <section aria-label="Zone counters">
        <p>
          Capacity {totals.capacity} &middot; Held {totals.held} &middot; Occupied {totals.occupied}{" "}
          &middot; Available {totals.capacity - totals.held - totals.occupied}
        </p>
      </section>

      <section aria-label="Occupancy grid">
        {zonesQuery.isLoading ? (
          <p>Loading zones&hellip;</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Floor</th>
                <th>Zone</th>
                <th>Capacity</th>
                <th>Held</th>
                <th>Occupied</th>
                <th>Available</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone.zoneId}>
                  <td>{zone.floorName}</td>
                  <td>{zone.zoneName}</td>
                  <td>{zone.capacity}</td>
                  <td>{zone.heldCount}</td>
                  <td>{zone.occupiedCount}</td>
                  <td>{zone.capacity - zone.heldCount - zone.occupiedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Reservations">
        <h2>Reservations</h2>
        {reservationsQuery.isLoading ? (
          <p>Loading reservations&hellip;</p>
        ) : (reservationsQuery.data ?? []).length === 0 ? (
          <p>No reservations yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Zone</th>
                <th>Status</th>
                <th>Held until</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(reservationsQuery.data ?? []).map((res) => (
                <tr key={res.reservationId}>
                  <td>{res.zoneName}</td>
                  <td>{res.status}</td>
                  <td>{new Date(res.heldUntil).toLocaleTimeString()}</td>
                  <td>{new Date(res.createdAt).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
