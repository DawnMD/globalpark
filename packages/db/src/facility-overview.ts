import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./client";
import { facility, floor, operatorMember, parkingZone, reservation } from "./schema";

/**
 * Read-side queries for the operator dashboard (Phase 3). Kept
 * separate from reservations.ts, which is the write-path transactional
 * functions -- these are plain selects with no invariants to protect.
 */

export type FacilitySummary = {
  facilityId: string;
  facilityName: string;
};

/**
 * D12-scoped: only facilities belonging to an operator this user is a
 * member of. Every read below that takes a facilityId is meant to be
 * reached only after this list (or isFacilityAccessibleToUser) has
 * confirmed access -- see packages/api/src/facility.ts's auth
 * middleware.
 */
export async function listFacilitiesForUser(userId: string): Promise<FacilitySummary[]> {
  const rows = await db
    .select({ facilityId: facility.id, facilityName: facility.name })
    .from(facility)
    .innerJoin(operatorMember, eq(operatorMember.operatorId, facility.operatorId))
    .where(eq(operatorMember.userId, userId))
    .orderBy(asc(facility.name));
  return rows;
}

export async function isFacilityAccessibleToUser(
  userId: string,
  facilityId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ facilityId: facility.id })
    .from(facility)
    .innerJoin(operatorMember, eq(operatorMember.operatorId, facility.operatorId))
    .where(and(eq(facility.id, facilityId), eq(operatorMember.userId, userId)));
  return row !== undefined;
}

export type ZoneOverview = {
  zoneId: string;
  zoneName: string;
  floorName: string;
  floorLevel: number;
  capacity: number;
  heldCount: number;
  occupiedCount: number;
};

export async function getFacilityZones(facilityId: string): Promise<ZoneOverview[]> {
  return db
    .select({
      zoneId: parkingZone.id,
      zoneName: parkingZone.name,
      floorName: floor.name,
      floorLevel: floor.level,
      capacity: parkingZone.capacity,
      heldCount: parkingZone.heldCount,
      occupiedCount: parkingZone.occupiedCount,
    })
    .from(parkingZone)
    .innerJoin(floor, eq(parkingZone.floorId, floor.id))
    .where(eq(floor.facilityId, facilityId))
    .orderBy(asc(floor.level), asc(parkingZone.name));
}

export type ReservationSummary = {
  reservationId: string;
  zoneId: string;
  zoneName: string;
  status: "HELD" | "EXPIRED" | "CANCELLED" | "CONVERTED";
  heldUntil: Date;
  createdAt: Date;
};

const DEFAULT_RESERVATION_LIMIT = 50;

export async function getFacilityReservations(
  facilityId: string,
  limit: number = DEFAULT_RESERVATION_LIMIT,
): Promise<ReservationSummary[]> {
  return db
    .select({
      reservationId: reservation.id,
      zoneId: reservation.zoneId,
      zoneName: parkingZone.name,
      status: reservation.status,
      heldUntil: reservation.heldUntil,
      createdAt: reservation.createdAt,
    })
    .from(reservation)
    .innerJoin(parkingZone, eq(reservation.zoneId, parkingZone.id))
    .innerJoin(floor, eq(parkingZone.floorId, floor.id))
    .where(eq(floor.facilityId, facilityId))
    .orderBy(desc(reservation.createdAt))
    .limit(limit);
}
