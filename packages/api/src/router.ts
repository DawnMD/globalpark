import { facilityRouter } from "./facility";
import { reservationRouter } from "./reservation";
import { sessionRouter } from "./session";

export const router = {
  reservation: reservationRouter,
  facility: facilityRouter,
  session: sessionRouter,
};
