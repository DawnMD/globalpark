import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * A terminal is one device at one facility (D16): the server URL is
 * where apps/web's rpc route is mounted, and the token is this
 * device's own -- minted once via issueDeviceToken (see
 * packages/db/src/seed.ts) and never rotated automatically here.
 */
export const env = createEnv({
  server: {
    TERMINAL_SERVER_URL: z.string().url(),
    TERMINAL_DEVICE_TOKEN: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
