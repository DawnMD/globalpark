import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * All three are server-only Postgres connection strings (D3b) -- there's
 * no client/server split in this package, so everything lives under
 * `server`.
 */
export const env = createEnv({
  server: {
    // Transaction pooler (port 6543). Ordinary queries and mutations.
    DATABASE_URL: z.url(),
    // Session pooler (port 5432). Required for LISTEN -- the transaction
    // pooler does not support it (D3b). Used only by the SSE route handler.
    DATABASE_URL_SESSION: z.url(),
    // Direct/session-level connection used only for running migrations.
    DATABASE_URL_DIRECT: z.url(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
