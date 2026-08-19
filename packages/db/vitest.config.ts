import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// These tests run against a real database, so the connection strings in
// env.ts have to be populated before the suite loads. Vite reads .env
// files for `import.meta.env`, not `process.env`, so load it here --
// optional, because CI supplies the same variables as real env vars.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// Vitest 4 narrowed the default `exclude` to node_modules and .git, so
// dist/ is no longer excluded -- and `pnpm build` emits compiled copies
// of these test files there. Scope collection to src so a stale build
// artifact can never be run as if it were a test.
export default defineConfig({ test: { dir: "src" } });
