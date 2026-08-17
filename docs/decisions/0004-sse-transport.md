# ADR 0004: Self-built SSE over LISTEN/NOTIFY, with a documented scaling ceiling

## Status
Accepted

## Context
Realtime updates (availability, occupancy) need to reach open dashboards and
the consumer app. Options considered: Supabase Realtime (managed), a
dedicated fan-out process, or building SSE ourselves on top of Postgres
`LISTEN`/`NOTIFY`, running on Vercel.

An earlier draft of this plan claimed serverless function-duration limits
made self-built SSE unworkable on Vercel and routed around it to Supabase
Realtime. That was incorrect and is corrected here: SSE routes hold an HTTP
response open and emit events as they arrive using the same runtime as the
rest of the API — it's supported, not a hack. The binding constraint is
function duration (300s on Hobby, up to 800s on Pro with Fluid Compute,
1800s in beta for specific runtimes), not capability. Because this design
streams *invalidation hints* rather than state, and `EventSource` reconnects
automatically with `Last-Event-ID` resume, periodic reconnection is a
non-event rather than a design problem.

## Decision
Build SSE ourselves: `LISTEN`/`NOTIFY` → an SSE route handler in Next.js, on
Vercel with Fluid Compute enabled and `maxDuration` set near the plan
ceiling. The `parking_event.id` is emitted as the SSE event id, so
`Last-Event-ID` replay on reconnect can replay hints for events since that
id — covering the reconnect window, not just steady state.

Payload is always an invalidation hint (topic + kind), never state:

```
id: 48211
event: invalidate
data: {"topic":"facility:42","kind":"availability"}
```

### Connection discipline this requires (see also `packages/db` client setup)
`LISTEN` does not work through Supabase's transaction-mode pooler
(open feature request since 2023). Two connection strings are required:

| Purpose | Connection | Why |
|---|---|---|
| Ordinary queries/mutations | Transaction pooler, port 6543 | Serverless-safe, high concurrency |
| The `LISTEN` connection in the SSE route | Session pooler (5432) or direct | Session state required for `LISTEN` |
| Migrations | Direct | Needs session-level state |

`prepare: false` is required on the transaction-pooled postgres-js client —
transaction pooling and prepared statements are incompatible, and the
failure mode is intermittent and confusing rather than a clean error.

## Consequences
- Each open SSE connection holds one Postgres session connection for its
  lifetime. This — not Vercel's timeout — is the real ceiling on the design.
  Fine for operator dashboards and a simulator; would not survive ten
  thousand concurrent users watching a garage.
- Fluid Compute reuses instances, but several will exist, each with its own
  listener; NOTIFY broadcasts to all of them, so connection count scales
  with instances, not just users.
- **Scaling escape hatch, documented now and not built:** when connection
  count becomes the binding constraint (measured in Phase 7's load test),
  the fix is one long-lived process (Fly, Railway) holding a single `LISTEN`
  connection and fanning out to many SSE clients, or Supabase Realtime as
  that same architecture managed. Because the client contract is just a
  topic and an invalidation hint, swapping the transport later touches no
  domain code.
