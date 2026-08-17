import { FacilityDashboard } from "./facility-dashboard";

export default async function FacilityDashboardPage({
  params,
}: {
  params: Promise<{ facilityId: string }>;
}) {
  const { facilityId } = await params;
  return <FacilityDashboard facilityId={facilityId} />;
}
