import { asc, desc, eq } from "drizzle-orm";
import { db } from "./client";
import { facility, floor, parkingZone, reservation } from "./schema";

/**
 * Read-side queries for the operator dashboard (Phase 3). Kept
 * separate from reservations.ts, which is the write-path transactional
 * functions -- these are plain selects with no invariants to protect.
 */

export type FacilitySummary = {
  facilityId: string;
  facilityName: string;
};

export async function listFacilities(): Promise<FacilitySummary[]> {
  const rows = await db
    .select({ facilityId: facility.id, facilityName: facility.name })
    .from(facility)
    .orderBy(asc(facility.name));
  return rows;
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
