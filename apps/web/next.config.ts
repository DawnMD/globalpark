import type { NextConfig } from "next";

/**
 * D3b: the SSE route holds a session-mode Postgres connection open for
 * its lifetime, which is fine on Vercel's Node runtime but incompatible
 * with the Edge runtime's connection model. `maxDuration` is set near
 * the Fluid Compute plan ceiling per D3/ADR-0004 -- ordinary routes stay
 * far under it; only the SSE route needs the extended value, and it
 * sets its own `export const maxDuration` in the route file.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 writes apps/web/AGENTS.md and CLAUDE.md on every `next dev`
  // otherwise. This repo keeps its own agent configuration, so opt out
  // rather than carry a generated CLAUDE.md scoped to this app.
  agentRules: false,
};

export default nextConfig;
