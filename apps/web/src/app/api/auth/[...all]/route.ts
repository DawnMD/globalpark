import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@parking-network/db/src/auth";

export const { GET, POST } = toNextJsHandler(auth);
