import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./client";
import * as schema from "./schema";

/**
 * Phase 3: operator-scoped access via Better Auth, email+password only
 * -- this is the operator dashboard's login, not the consumer app's
 * (that arrives in Phase 6 and may or may not reuse this same `user`
 * table; D12 treats users as network-level citizens, so it's plausible
 * either way, and deciding now would be guessing).
 *
 * `nextCookies()` lets Better Auth set the session cookie directly from
 * Server Actions/Route Handlers in apps/web without extra plumbing --
 * harmless to include here even though this instance itself is
 * framework-agnostic.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  plugins: [nextCookies()],
});
