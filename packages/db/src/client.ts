import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";
import * as schema from "./schema/index";

/**
 * Transaction-pooled connection (port 6543) for ordinary queries and
 * mutations. Serverless-safe, high concurrency. `prepare: false` is
 * required here: transaction pooling and prepared statements are
 * incompatible, and the failure mode is intermittent and confusing
 * rather than a clean error (D3b).
 */
const queryClient = postgres(env.DATABASE_URL, { prepare: false });
export const db = drizzle(queryClient, { schema });

/**
 * For one-shot scripts (seed.ts) that import `auth` (and therefore
 * this module) and need the process to actually exit afterward --
 * `queryClient`'s open sockets otherwise keep the event loop alive
 * indefinitely. Long-lived servers (the Next.js app) should never
 * call this.
 */
export function closeDb(): Promise<void> {
  return queryClient.end();
}

/**
 * Session-mode connection (port 5432), required for `LISTEN` (D3b).
 * `LISTEN` does not work through Supabase's transaction-mode pooler.
 * Create one of these per SSE connection, never for ordinary queries —
 * each one holds a Postgres session open for its lifetime.
 */
export function createListenClient() {
  return postgres(env.DATABASE_URL_SESSION, { max: 1 });
}
