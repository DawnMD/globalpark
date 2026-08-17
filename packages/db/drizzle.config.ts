import { defineConfig } from "drizzle-kit";

// Migrations run over the direct connection (session-level state, no
// pooler in the way) per D3b. Never point this at the transaction pooler.
const directUrl = process.env.DATABASE_URL_DIRECT;
if (!directUrl) {
  throw new Error("DATABASE_URL_DIRECT is required to run migrations (see .env.example)");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: directUrl,
  },
});
