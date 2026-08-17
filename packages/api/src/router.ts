import { facilityRouter } from "./facility";
import { reservationRouter } from "./reservation";

export const router = {
  reservation: reservationRouter,
  facility: facilityRouter,
};
