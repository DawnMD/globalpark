import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@parking-network/db/src/auth";
import { isFacilityAccessibleToUser } from "@parking-network/db/src/facility-overview";
import { FacilityDashboard } from "./facility-dashboard";

export default async function FacilityDashboardPage({
  params,
}: {
  params: Promise<{ facilityId: string }>;
}) {
  const { facilityId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  // D12: the middleware only checked "signed in", not "allowed to see
  // *this* facility" -- that requires the DB, which is exactly what
  // this checks before rendering anything from it.
  const allowed = await isFacilityAccessibleToUser(session.user.id, facilityId);
  if (!allowed) {
    notFound();
  }

  return <FacilityDashboard facilityId={facilityId} />;
}
