import Link from "next/link";
import { listFacilities } from "@parking-network/db/src/facility-overview";

// Server Component: a plain select with no realtime need, so this
// calls packages/db directly rather than round-tripping through the
// app's own oRPC HTTP route (see src/lib/orpc-client.ts's comment).
export default async function DashboardIndexPage() {
  const facilities = await listFacilities();

  return (
    <main>
      <h1>Operator Dashboard</h1>
      {facilities.length === 0 ? (
        <p>No facilities yet.</p>
      ) : (
        <ul>
          {facilities.map((facility) => (
            <li key={facility.facilityId}>
              <Link href={`/dashboard/${facility.facilityId}`}>{facility.facilityName}</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
