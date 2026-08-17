# ADR 0001: PostgreSQL, not Convex

## Status
Accepted

## Context
The project's stated purpose is to learn concurrency, event-driven design, and
distributed-systems failure modes. Convex is technically capable of the
concurrency requirements here (serializable mutations, reactive queries), but
would remove exactly the problems this project exists to practice. The
original stack-comparison already conceded "Offline devices: Custom / Custom"
on both sides — the hard half of this project stays hard regardless of
datastore, so Convex only buys away the easy half.

Two concrete disqualifiers beyond the philosophical one:

- **Geospatial.** "Nearby parking" is in the MVP (Phase 6). PostGIS gives
  `ST_DWithin` over a GiST index for free; Convex has no native geospatial
  index, which would mean hand-rolled bounding-box scans.
- **Familiarity cost is already paid.** The Prisma/oRPC/Postgres path is not
  slower for this developer, which was Convex's main advantage.

## Decision
Postgres (via Supabase) is the primary datastore. No Convex.

## Consequences
- We own connection-pooling discipline (see ADR 0004) instead of getting it
  for free.
- We own realtime delivery (`LISTEN`/`NOTIFY` → SSE) instead of getting
  reactive queries for free.
- PostGIS and `pg_cron` are available and used from Phase 1 onward.
