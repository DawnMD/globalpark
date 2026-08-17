import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVehicleByPlate } from "./vehicles";
import { rawSql } from "./test/fixtures";

let plates: string[] = [];

afterEach(async () => {
  for (const plate of plates) {
    await rawSql`DELETE FROM vehicle WHERE license_plate = ${plate}`;
  }
  plates = [];
});

describe("resolveVehicleByPlate", () => {
  it("creates a vehicle on first sighting", async () => {
    const plate = `TEST-${randomUUID()}`;
    plates.push(plate);

    const vehicleId = await resolveVehicleByPlate(plate);

    const [row] = await rawSql`SELECT id FROM vehicle WHERE license_plate = ${plate}`;
    expect(row.id).toBe(vehicleId);
  });

  it("returns the same vehicle id on a repeat sighting of the same plate", async () => {
    const plate = `TEST-${randomUUID()}`;
    plates.push(plate);

    const first = await resolveVehicleByPlate(plate);
    const second = await resolveVehicleByPlate(plate);

    expect(second).toBe(first);
  });
});
