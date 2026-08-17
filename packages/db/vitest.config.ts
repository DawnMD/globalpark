import { defineConfig } from "vitest/config";

// Vitest 4 narrowed the default `exclude` to node_modules and .git, so
// dist/ is no longer excluded -- and `pnpm build` emits compiled copies
// of these test files there. Scope collection to src so a stale build
// artifact can never be run as if it were a test.
export default defineConfig({ test: { dir: "src" } });
