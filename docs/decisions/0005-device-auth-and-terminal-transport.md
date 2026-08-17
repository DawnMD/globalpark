# ADR 0005: Device authentication and terminal transport

## Status

Accepted

## Context

The standalone terminal (D13, D16) is infrastructure, not a person: it needs
to authenticate as a device and needs some way to reach the server. Options
considered for authentication: reuse Better Auth sessions (wrong shape — a
device has no email/password and no browser to hold a cookie), a shared
static secret per facility (no per-device revocation), or per-device bearer
tokens. For transport: a separate protocol/route for devices, or the same
oRPC router the dashboard already uses.

## Decision

**Per-device bearer tokens, hashed at rest.** `issueDeviceToken` generates a
random token and stores only its SHA-256 hash (`packages/db/src/devices.ts`);
the plaintext is returned once, at issuance, the same way a password would
be. `verifyDeviceToken` looks it back up by hash and bumps `last_seen_at`.

**One route, two credentials.** apps/web's already-mounted
`app/api/rpc/[[...rest]]` route resolves both a Better Auth session (cookie)
and a device token (`Authorization: Bearer <token>` header) independently on
every request and hands both to oRPC as context. `authed` (dashboard
procedures) and `deviceAuthed` (terminal procedures) each require their own
half of that context; a request can carry neither, either, or in principle
both, but no procedure ever needs both at once. Standing up a second route
or a second protocol for the terminal would have duplicated the request
plumbing for no benefit — the terminal is just another oRPC client
(`@orpc/client`'s `RPCLink`, pointed at a remote origin over plain HTTP
instead of same-origin from a browser).

**The server assigns the spot, not the device.** D4 says "the physical spot
is assigned at the gate"; concretely, `startSession` picks an `AVAILABLE`
spot itself via `SELECT ... FOR UPDATE SKIP LOCKED`, so the terminal's
`entry` command only ever supplies a vehicle (and optionally a reservation),
never a spot id. This is the other half of D2's `FOR UPDATE SKIP LOCKED`
justification: concurrent gate entries lock and skip past whatever another
transaction already claimed, racing for distinct spots instead of
serializing on one lock or double-assigning one — a deliberately different
concurrency technique from D4's hot-row zone counter.

## Consequences

- A device token proves exactly one thing — which facility the device
  belongs to — and every device-authed handler treats that as the only fact
  it can trust. `session.entry`/`session.exit` only ever look at spots in
  that facility; `session.sensorEvent` checks a given spot id belongs to it
  before doing anything (`isSpotInFacility`), so a stolen token can't be
  pointed at another operator's spot by id.
- A compromised device token is scoped to one facility and one device row —
  revocation is deleting that row (or rotating its hash), not a network-wide
  secret rotation.
- The terminal's own token lives in its environment
  (`TERMINAL_DEVICE_TOKEN`), never in source; `packages/db/src/seed.ts`
  prints a fresh one for the seeded facility on every `pnpm db:seed`.
- This is the seam Phase 5's durable terminal replaces the far side of:
  today the terminal is a synchronous oRPC client that fails a command if
  the request fails, and Phase 5 turns that into a local SQLite queue with
  its own retry/replay logic. The credential and the route don't change —
  only what sits behind `orpc.session.*` on the terminal's side does.
