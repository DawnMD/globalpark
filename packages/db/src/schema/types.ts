import { customType } from "drizzle-orm/pg-core";

/**
 * PostGIS geography point. Drizzle's pg-core has no native geospatial
 * column type, so this is expressed as a raw SQL type via customType.
 * Used by facility.location for Phase 6's ST_DWithin discovery queries.
 *
 * Known drizzle-kit quirk: `generate` quotes this parametrized type name
 * like an enum identifier (`"geography(Point,4326)"`), which is invalid
 * SQL. Hand-fix any freshly generated migration touching this column
 * (strip the quotes) before applying it.
 */
export const geographyPoint = customType<{ data: string }>({
  dataType() {
    return "geography(Point,4326)";
  },
});
