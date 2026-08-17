import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@parking-network/db/src/auth";
import { listFacilitiesForUser } from "@parking-network/db/src/facility-overview";

// Server Component: session check + a plain select, both with no
// realtime need, so this calls Better Auth and packages/db directly
// rather than round-tripping through the app's own oRPC HTTP route
// (see src/lib/orpc-client.ts's comment).
export default async function DashboardIndexPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  const facilities = await listFacilitiesForUser(session.user.id);

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
