import { defineConfig } from "drizzle-kit";
import { env } from "./src/env";

// Migrations run over the direct connection (session-level state, no
// pooler in the way) per D3b. Never point this at the transaction pooler.
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL_DIRECT,
  },
});
