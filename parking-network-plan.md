# Global Parking Network — Decisions & Phased Build Plan

This supersedes the open questions in §17 and §21 of the original proposal. Everything in Part 1 is a locked decision with a stated reason; Part 2 sequences the build around them. Part 3 lists what's still genuinely undecided.

---

# Status — 2026-08-19

**Phases 1 through 4 are built and on `master`. Phase 5 has not started.**

| Phase                                    | State                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| 1 — Foundations                          | Done. Schema, constraints, NOTIFY trigger, seed, CI, ADRs 0001–0004.              |
| 2 — Reservation core                     | Done. State machines, holds, `pg_cron` sweeper, 200-way adversarial test.         |
| 3 — Realtime + operator dashboard        | Done, deployed to Vercel. `Last-Event-ID` replay is live, not stubbed.            |
| 4 — Sessions + online terminal           | Done. Standalone terminal process, device tokens, ADR-0005.                       |
| 5 — Offline, idempotency, reconciliation | **Not started. This is the next thing.**                                          |
| 6 — User app and discovery               | Not started. PostGIS is installed; `facility.location` is nullable and unseeded.  |
| 7 — Multi-tenancy hardening              | Not started. No RLS policies exist; tenancy is enforced in application code only. |

Two things worth knowing that the phase list alone doesn't say:

- **D10's idempotency is half-built.** `local_seq`, the `(device_id, local_seq)` unique index, and the stored-response column all exist in the schema, but no write path populates them. Every device event today is non-idempotent, and the constraint has never fired. Wiring it is Phase 5 work, but it is not a fresh design problem — the hard part is already in the migration.
- **The recent commits are maintenance, not progress.** Next 16, zod 4, drizzle 0.45, vitest 4, fast-check 4. Good hygiene (see D17), but the offline work is where the project's actual purpose lives.

---

# Part 1 — Locked Decisions

## D1. PostgreSQL, not Convex

**Decision:** Postgres is the primary datastore. No Convex.

**Why:** Convex is technically capable here — serializable mutations, real reactive queries — but the project's stated purpose is to learn concurrency, event-driven design, and distributed-systems failure modes. Convex removes exactly those problems from the curriculum. Note that the original comparison table already lists "Offline devices: Custom / Custom" — the hard half of this project stays hard on both stacks, so Convex only buys away the easy half.

Two concrete disqualifiers beyond the philosophical one:

- **Geospatial.** "Nearby parking" is in the MVP. PostGIS gives `ST_DWithin` over a GiST index for free; Convex has no native geospatial index and would mean hand-rolled bounding-box scans.
- **Familiarity cost is already paid.** The Prisma/oRPC/Postgres path is not slower _for this developer_, which was Convex's main advantage in the table.

## D2. Drizzle over Prisma

**Decision:** Drizzle ORM.

**Why:** This schema leans on partial unique indexes, `FOR UPDATE SKIP LOCKED`, PostGIS column types, and triggers. Drizzle expresses all of these natively and stays out of the way of raw SQL. Prisma will work, but partial indexes and PostGIS need hand-written migration SQL that sits outside the schema file, and the locking clauses need `$queryRaw` — which means the interesting parts of the system live in escape hatches.

**Reversal cost:** Low in Phase 0, high after Phase 2. Decide before writing the schema.

## D3. Self-built SSE over `LISTEN/NOTIFY` — _corrected_

An earlier draft of this plan claimed serverless killed this design. That was wrong, and the correction matters because it restores the option you'd actually learn the most from.

**What's actually true on Vercel:**

- <cite index="3-1">SSE routes hold an HTTP response open and emit events as they arrive, using the same runtime as the rest of the API</cite>. It is supported, not a hack.
- The constraint is function duration, not capability. <cite index="20-1">With Fluid Compute enabled, Hobby gets 300 seconds and Pro/Enterprise up to 800 seconds</cite>, with <cite index="14-1">an extended 1800-second maximum in beta for specific Node.js and Python runtime versions</cite>.
- <cite index="3-1">When the server emits event IDs and retains replayable events, the browser sends `Last-Event-ID` on reconnect so the server can resume from the last delivered event — automatic reconnection through `EventSource` is the clearest operational advantage SSE has over WebSocket, where reconnection is code you write yourself.</cite>

A connection that recycles every 5–13 minutes would be a problem for a design that streamed state. **It is a non-problem for this design**, because the payload is an invalidation hint and reconnect simply means "invalidate everything and refetch." The transport being lossy and periodically severed is already the assumption the whole thing is built on.

**Decision:** build it yourself. `LISTEN/NOTIFY` → SSE route handler in Next.js, on Vercel, with Fluid compute enabled and `maxDuration` set near the plan ceiling.

**Payload stays an invalidation hint:**

```
id: 48211
event: invalidate
data: {"topic":"facility:42","kind":"availability"}
```

Emit the `parking_event` id as the SSE event id. On reconnect the browser sends `Last-Event-ID` automatically, and you can replay hints for events since that id — which means even the _window_ during reconnect is covered, not just the steady state. This is a genuinely nice property that falls out of D7's event table for free.

**NOTIFY's constraints still bind:** fire-and-forget, no delivery guarantee, 8KB payload cap. Never ship state through it.

## D3b. The connection discipline this requires

This is the part that actually needs care, and it's a Postgres constraint rather than a Vercel one.

**`LISTEN` does not work through transaction-mode pooling.** Supavisor has had this open as a feature request since 2023, and applications relying on `LISTEN/NOTIFY` through the transaction pooler have broken in the field. You need **two connection strings**:

| Purpose                                  | Connection                           | Why                                    |
| ---------------------------------------- | ------------------------------------ | -------------------------------------- |
| Ordinary queries and mutations           | Transaction pooler (port 6543)       | Serverless-safe, high concurrency      |
| The `LISTEN` connection in the SSE route | Session pooler (port 5432) or direct | Session state is required for `LISTEN` |
| Migrations                               | Direct                               | Needs session-level state              |

Consequences to hold in mind:

- **`prepare: false`** on postgres-js under Drizzle for the transaction-pooled client. Transaction pooling and prepared statements are incompatible and the failure is intermittent and confusing. The session-mode client can prepare normally.
- **Each open SSE connection holds one Postgres session connection** for its lifetime. This is the real ceiling on the design — not Vercel's timeout. On a small Supabase tier you have tens of these, not thousands. Fine for operator dashboards and a simulator; it would not survive ten thousand concurrent users watching a garage.
- **Instance fan-out.** Fluid compute reuses instances, but there will be several, each with its own listener. That's fine — NOTIFY broadcasts to all listeners — but it means the connection count scales with instances, not just users.
- **Billing shape.** Active CPU pricing means an idle SSE connection costs almost nothing in CPU, but provisioned memory time still accrues for the open duration. At this project's scale it's noise; it's worth knowing why the bill has a floor.

**The scaling escape hatch, documented now and not built:** when connection count becomes the binding constraint, the fix is one long-lived process (Fly, Railway) holding a _single_ `LISTEN` connection and fanning out to many SSE clients — or Supabase Realtime, which is that same architecture as a managed service. Because the client contract is just a topic and an invalidation hint, swapping the transport later touches no domain code. Write the ADR now while the reasoning is fresh.

## D4. Reservations are capacity holds, not spot claims

**Decision:** A reservation holds _a unit of capacity in a zone_, not bay A102. The physical spot is assigned at the gate.

**Why:** This is how real garages work, and for a good reason — if a reservation names a specific bay, the system must handle a stranger parking in that bay, and it has no enforcement mechanism. Holding capacity makes that scenario a non-event.

**Mechanics:**

```sql
UPDATE parking_zone
   SET held_count = held_count + 1
 WHERE id = $1
   AND held_count + occupied_count < capacity
RETURNING id;
```

Zero rows = CONFLICT. Backed by a `CHECK (held_count + occupied_count <= capacity)` constraint so the invariant survives any code path.

This is a _different_ concurrency problem from row locking — it's hot-row contention on the zone counter, which is the more interesting one to learn.

## D5. Spot state is physical occupancy only

**Decision:** `parking_spot.status` records what is physically true, and is written by terminal/sensor events — never by the reservation flow.

Revised state set and transitions:

```
AVAILABLE ──occupy──> OCCUPIED ──release──> AVAILABLE
AVAILABLE ──block───> BLOCKED  ──unblock──> AVAILABLE
    any   ──fault───> OUT_OF_SERVICE ──repair──> AVAILABLE
```

`RESERVED` is deleted from the spot state machine. It lives on the reservation, not the concrete.

## D6. Holds expire

**Decision:** Every hold carries `held_until`. Expiry is a first-class transition.

**Why:** A hold with no TTL leaks inventory permanently — the single most common way a booking system silently degrades. The original §10 state machine had no exit from RESERVED at all.

**Mechanics:** Lazy expiry on read (treat `held_until < now()` as expired everywhere) _plus_ a sweeper that decrements the zone counter and writes a `reservation.expired` event. Lazy alone leaves the counter wrong; the sweeper alone leaves a race window.

**Run the sweeper as `pg_cron` inside Postgres.** Vercel Cron on Pro can do minute-level schedules and would work, but `pg_cron` needs no deploy target, no auth on the endpoint, no cold start, and keeps the job next to the data it corrects. It also can't be accidentally invoked twice by a retry. Use Vercel Cron only for jobs that genuinely need application code.

## D7. One append-only event table — audit, outbox, and reconciliation source

**Decision:** Every state transition appends a `parking_event` row **inside the same transaction** as the state change. No message bus, no separate outbox table.

This resolves §8 as "both, and they're the same table." That one table is simultaneously:

- audit trail
- outbox (a trigger on insert fires the NOTIFY)
- debugging log
- reconciliation source
- future analytics feed

**Columns that matter:** `occurred_at` (device clock — untrusted) and `recorded_at` (server clock) as **separate columns, never mixed**. Device clocks drift and lie; you will need both to debug the first offline replay bug.

## D8. Invariants in the database, state machine in TypeScript

**Decision:** Correctness is enforced by constraints. The TypeScript state machine is documentation and UX guardrail, not the guarantee.

Non-negotiable constraints:

```sql
-- one active session per spot, ever
CREATE UNIQUE INDEX one_active_session_per_spot
  ON parking_session (spot_id) WHERE status = 'ACTIVE';

-- one active session per vehicle across the whole network
CREATE UNIQUE INDEX one_active_session_per_vehicle
  ON parking_session (vehicle_id) WHERE status = 'ACTIVE';

-- capacity can never be oversold
ALTER TABLE parking_zone
  ADD CONSTRAINT capacity_not_exceeded
  CHECK (held_count + occupied_count <= capacity);
```

Application code can be bypassed by a script, a migration, or a bug. These cannot.

## D9. Split authority

**Decision:**

| Concern                         | Authority    | Rule on conflict                                                                   |
| ------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| Physical occupancy              | The facility | Facility wins, always. A car is in the bay or it isn't; reality doesn't roll back. |
| Reservations, identity, pricing | The network  | Server wins. Only it sees all users.                                               |

**Consequence:** on offline replay, physical events (`entry.detected`, `exit.detected`) are applied unconditionally and may trigger _compensating actions_ — an honored reservation that can no longer be honored becomes a refund or a relocation, not a rejected event. Logical events yield to server state.

Writing this down is what makes reconciliation tractable rather than mysterious.

## D10. Device-generated idempotency keys

**Decision:** `(device_id, local_seq)` with a unique constraint, plus a stored response body.

**Why the stored response:** a naive unique-constraint-swallow makes a retry look like a failure to the device, which then retries forever. Return the _original_ response on duplicate.

`local_seq` is a monotonic counter persisted on the device, surviving restart. Ordering within a device is by `local_seq`; there is deliberately **no global ordering** across devices — don't build one.

## D11. Snapshot reconciliation, not event replay alone

**Decision:** Every facility periodically pushes a full-state snapshot: "here are my 120 bays and their current states." Derived occupancy state is overwritten wholesale from it.

**Why this is the thing most likely to be missed:** event replay will not converge in the real world. Sensors miss exits. Cars tailgate through gates. Spots get stuck OCCUPIED forever with no matching exit event. Events give you the _why_; snapshots give you the _truth_. Retrofitting snapshots after the event model has hardened is miserable — design the endpoint in Phase 0 even if it isn't called until Phase 4.

Every snapshot-driven correction writes a `spot.reconciled` event, so drift is measurable.

## D12. Tenant boundary is the operator

**Decision:** `operator_id` is the tenancy column. Facilities, zones, spots, and devices are all operator-scoped.

**The trap:** users are **not** tenant members. They are network-level citizens who cross tenants freely. Reservations and sessions are the join across that boundary and belong to both — expect the RLS policies there to be the interesting ones. Model it explicitly now; a single `tenant_id` on everything will be wrong.

`ParkingNetwork` as a root entity is dropped (YAGNI — there is one network).

## D13. Minimal monorepo

**Decision:**

```
parking-network/
├── apps/
│   ├── web/          # user app, operator dashboard — route groups
│   └── terminal/     # standalone Node terminal + device simulator
├── packages/
│   ├── api/          # oRPC router and procedures, shared by web and terminal
│   ├── db/           # drizzle schema, migrations, queries
│   ├── domain/       # state machines, event types, zod schemas
│   └── protocol/     # device↔server contract, shared by both apps
├── docs/decisions/   # ADRs
└── turbo.json
```

Two apps, not four. The operator dashboard is a route group in `web`, not a separate deployable — it shares auth, components, and data layer with the user app, and splitting it buys nothing but configuration. The terminal _is_ separate, because it deploys differently and must run when the network doesn't (see D16). `protocol` exists so the device contract can't drift between the two.

Split further only when a boundary demonstrably hurts.

**`packages/api` was added in Phase 3, and it earned its place.** The oRPC router originally lived inside `apps/web`. Once the terminal needed a typed client against the same procedures, keeping the router inside a Next.js app meant the terminal would have had to depend on `web` — a deployable depending on another deployable, for types. Extracting the router is the boundary demonstrably hurting, so the split is exactly the trigger this decision described. `web` now mounts the router at `/api/rpc`; `terminal` calls it over HTTP with a device token.

## D14. Skip the dual prototype

**Decision:** No Convex prototype. Both stacks would pass the §18 scenario, because both handle single-row contention correctly — two weekends to learn a predictable result.

**Spike this instead:** offline terminal reconciliation on Postgres (Phase 5), which is where the design is genuinely undetermined.

## D15. Adversarial concurrency testing as a gate

**Decision:** the acceptance test is 200 concurrent reservation attempts against a zone with 1 remaining unit, asserting **exactly one** success and 199 clean CONFLICTs, with the zone counter landing exactly at capacity. Repeated 50×.

Two users proves nothing. This test is written in Phase 2 and runs in CI forever after.

## D16. The terminal is a real process with a durable queue

**Decision:** a standalone Node process with a **SQLite queue on disk**, not a browser tab with an in-memory queue.

**Why this changed:** at a few hours a week, a browser simulator was the correct trade — a real process would have eaten weeks for a marginal gain. At full-time it costs about three days and buys the only scenario that matters: a terminal killed mid-write that comes back and replays. An in-memory queue makes crash recovery untestable, and crash recovery is where duplicate-event bugs actually live.

The terminal also gets device auth (operator-issued long-lived tokens) rather than user sessions, since it is infrastructure, not a person.

## D17. Latest stable everything, and stay there

**Decision:** every dependency tracks the latest stable major. No pinning to an older line for comfort. Upgrades happen as their own commits, not folded into feature work.

Where that currently lands: Node 20.9+, pnpm 11, TypeScript 5.9, Next.js 16 (React 19), Drizzle ORM 0.45 with drizzle-kit 0.31, zod 4, vitest 4, fast-check 4, ESLint 10, Better Auth 1.6, oRPC 1.15.

**Why:** this project has no users, no SLA, and no migration window to protect. That is exactly the condition under which staying current is nearly free, and it's the only time it ever will be. Deferring a major upgrade doesn't avoid the cost, it compounds it — a Next 15→16 jump is an afternoon, a 15→18 jump is a week of guessing which change broke what. The same argument applies with more force to Drizzle, which is pre-1.0 and moving.

**The rule that makes this safe:** upgrades land as isolated commits with CI green, never mixed into a feature. The history already does this (`feat: upgrade zod to 4…`, `test(db): upgrade fast-check to 4`), which is why the Next 16 migration was legible instead of a mystery. Keep it.

**The cost, stated honestly:** pre-1.0 and freshly-major packages break in ways the changelog doesn't cover. Budget for that rather than being surprised by it. If an upgrade fights back for more than a day, park it behind an ADR and move on — the point is to stay current, not to prove something.

## D18. shadcn/ui on Base UI, adopted last

**Decision:** the UI layer is shadcn/ui backed by **Base UI** (not Radix). It goes in **last, as Phase 8**, after the correctness work is finished.

**Why Base UI:** it's the successor line from the same people behind Radix and MUI Base, shadcn supports it as a first-class backing library, and it's where the ecosystem's accessibility primitives are actually being maintained now. Picking Radix today would mean choosing the branch that is winding down.

**Why shadcn's copy-in model fits this project specifically:** components land in the repo as source you own, not as a versioned dependency. That composes with D17 — there is no component library major upgrade to chase, because there is no component library, just files. It also means the operator dashboard's occupancy grid can be a genuinely custom component sitting next to stock primitives without fighting a theme API.

**Why last, deliberately:** every phase through 7 is about correctness under concurrency, offline convergence, and tenancy. None of that is easier with a design system, and a half-built one is a tax on every screen you touch while the data layer is still moving. The dashboard shipped in Phase 3 on plain CSS and that was the right call. It stays on plain CSS until the system underneath it stops changing.

**Consequences to plan for:**

- Tailwind arrives with shadcn, not before. Don't half-adopt it in Phase 6 "to save time later" — mixed styling is worse than either alternative.
- The rewrite touches `apps/web` only. `packages/api`, `db`, `domain`, and `protocol` are untouched, which is the whole reason deferring is cheap.
- The Phase 6 consumer app will be built on plain CSS and then restyled. That's accepted duplicate effort, and it's smaller than the effort of maintaining a design system across four phases of churn.
- A shadcn/Base UI skill gets added to the toolchain when this phase starts, not now.

---

# Part 2 — Phased Plan

Phases are ordered by _risk retired_, not by feature visibility. The UI arrives late on purpose.

**Sizing.** These estimates assume full-time, heads-down work — call it 35–40 focused hours a week. Total to a genuinely complete system: **roughly twelve to fourteen weeks.** That is enough runway to build the thing properly rather than the compressed version, so the scope below restores what the weekend budget had cut: the consumer app is back in the MVP, geospatial discovery is back in Phase 5, and the terminal becomes a real standalone process rather than a browser tab.

**One decision worth revisiting given the new budget.** A browser-tab simulator with an in-memory queue was the right call at four hours a week. It isn't now. A standalone Node process with a **SQLite queue on disk** costs roughly three extra days and buys the one thing the browser version cannot test: a terminal that is killed mid-write and comes back. That scenario — process dies during replay, restarts, replays again — is exactly where duplicate-event bugs live, and it is the whole point of Phase 5. This is D16.

**Phase 8 is new.** D18 puts the design system last, so the numbered plan now runs to eight phases plus a backlog rather than seven. It doesn't extend the schedule much, because it's a restyle of screens that already work, not new behaviour.

---

## Phase 1 — Foundations _(week 1)_ — **done**

**Goal:** a schema that makes the important bugs impossible.

- Turborepo + pnpm, the workspaces from D13
- Supabase project; PostGIS and `pg_cron` enabled day one (D1, D6)
- Both connection strings wired correctly — transaction pooler for queries, session pooler for `LISTEN`, direct for migrations (D3b)
- Drizzle schema: operator, facility, floor, zone, spot, vehicle, reservation, session, device, parking_event
- All constraints from D8, `CHECK` from D4
- `parking_event` table + `NOTIFY` trigger carrying topic and event id (D3, D7)
- Snapshot ingest contract defined in `protocol`, endpoint stubbed, unused until Phase 5 (D11)
- Seed script: 1 operator, 1 facility, 3 floors, 6 zones, 120 spots
- CI from day one: lint, typecheck, migrations-apply-cleanly, tests
- First ADRs: choice of Postgres, capacity-hold model, split authority, SSE transport with its scaling ceiling

**Exit criteria:** you cannot violate any invariant by hand from `psql`. Try to, deliberately. Oversell a zone, double-occupy a spot, give a vehicle two active sessions — all three must fail at the database, and the failure messages must be legible.

**Not in this phase:** any UI, any auth, any HTTP.

## Phase 2 — Reservation core, headless _(week 2)_ — **done**

**Goal:** prove D4 and D15 before anything can depend on being wrong.

- Domain package: spot and reservation state machines as pure functions, exhaustively tested
- `createHold` / `releaseHold` / `expireHolds` as transactional functions
- oRPC procedures over them
- The 200-way adversarial test (D15), running in CI
- `pg_cron` sweeper for expired holds (D6), plus lazy-expiry reads
- Test: hold expiry under a clock jumped forward mid-transaction
- Test: zone counters reconstructed from the event log match the counter column exactly, property-tested over random operation sequences

**Exit criteria:** the adversarial test passes 50 consecutive runs. Counter and event log agree under randomized operation orders.

**Not in this phase:** UI, sessions, devices.

## Phase 3 — Realtime + operator dashboard _(weeks 3–4)_ — **done**

**Goal:** validate D3 end to end with a real screen, on real Vercel.

- SSE route handler holding a session-mode `LISTEN` connection, topic-scoped per facility
- SSE event ids emitted from `parking_event.id`; `Last-Event-ID` replay on reconnect (D3)
- Client subscription hook wired to TanStack Query invalidation
- Operator dashboard: live occupancy grid, zone counters, reservation list
- Better Auth with operator-scoped access
- **Deploy to Vercel this phase, not later.** The connection-limit and duration behaviour must be observed on the real platform while the design is still cheap to change.

**Exit criteria:** two browser windows; a hold in one appears in the other in under a second. Kill the connection in devtools, create three holds while it's down, restore — the UI converges with no page reload, and the `Last-Event-ID` replay covers the gap. Leave a dashboard open for an hour and confirm the function-duration recycle is invisible to the user.

**Not in this phase:** the user-facing app, sessions.

## Phase 4 — Sessions and the online terminal _(week 5)_ — **done**

**Goal:** close the physical loop while the network is perfect.

- Session lifecycle: `startSession` (spot assigned at gate, per D4), `endSession`
- Standalone terminal app: entry, exit, occupy, release, disconnect toggle
- Device auth: long-lived operator-issued tokens, distinct from user sessions
- Spot occupancy transitions driven only by terminal events (D5)
- Hold → session conversion, including the "arrived without a hold" path

**Exit criteria:** operator creates a facility, a hold is placed, the terminal starts a session, occupancy updates live on two dashboards, the terminal ends it, capacity returns.

**Not in this phase:** offline anything.

## Phase 5 — Offline, idempotency, reconciliation _(weeks 6–9)_ ← _the point of the project_

**Goal:** make the network's absence a normal operating condition.

- SQLite event queue on the terminal, durable across process death. The `disconnect`/`connect` toggle already in `apps/terminal` is the seam this plugs into; today disconnected just refuses to send.
- Local decision-making while disconnected: the terminal admits cars on its own authority (D9)
- `(device_id, local_seq)` idempotency with stored responses (D10). **Half of this already exists** — the column, the partial unique index, and the stored-response column are in the schema and have been since Phase 1. What's missing is every write path populating them, and the duplicate-returns-original-response behaviour. Do this before the queue, not after: an unauthenticated replay against a non-idempotent write path will corrupt data faster than you can read the test output.
- Replay on reconnect: ordered per device, no global ordering
- Compensating actions when a hold can no longer be honored
- Snapshot ingest goes live (D11); `spot.reconciled` events on every correction
- A drift dashboard: reconciliation events over time, so divergence is visible rather than silent
- Chaos suite as automated tests, not manual clicking: duplicate events, out-of-order arrival, clock skew, double replay, snapshot disagreeing with the event stream, process killed mid-replay

**Exit criteria:** disconnect a terminal, run 50 entries and exits offline, reconnect, replay the queue **twice**, and land in a state identical to having been online throughout. Then repeat while `SIGKILL`-ing the terminal partway through replay. Then again with the server rejecting every third request. All three converge, and every correction is visible in the event log.

This is the reason the project exists. Four weeks is not padding — the failure modes here are subtle and the tests that prove them are most of the work.

## Phase 6 — User app and discovery _(weeks 10–11)_

- Consumer app: facility view, live availability, create hold, active session, history
- PostGIS discovery: nearby facilities, distance sort, `ST_DWithin` over a GiST index. The extension and the `facility.location` column exist; the column is nullable and unseeded, so this phase starts by giving facilities real coordinates.
- Map view
- Multi-operator, multi-facility seed data

**Styling:** plain CSS, same as the Phase 3 dashboard. Per D18 the design system lands in Phase 8 — resist pulling Tailwind in here.

**Exit criteria:** the full §20 flow from the original proposal, end to end, from a phone.

## Phase 7 — Multi-tenancy hardening and observability _(weeks 12–13)_

**Goal:** the things that separate a demo from a system.

- RLS policies, including the users-cross-tenants boundary from D12, proven by test rather than inspection
- Device heartbeats, last-seen, stale-device alerts
- Structured logging and tracing across the mutation → event → notify → SSE path — you will want this the first time a realtime update goes missing
- Load test: several hundred concurrent SSE subscribers against one facility, to find the connection ceiling from D3b empirically rather than theoretically
- Runbook: what to do when the event log and the counters disagree

**Exit criteria:** operator A cannot see or mutate operator B's data. You know, with a number, how many concurrent dashboards this architecture supports before the transport must change.

## Phase 8 — Design system pass _(week 14)_

**Goal:** make it look like a product, once the product has stopped moving.

- Tailwind, then shadcn/ui initialised against **Base UI** (D18)
- Add the shadcn/Base UI skill to the toolchain at the start of this phase
- Restyle the operator dashboard and the consumer app off plain CSS
- Keep the occupancy grid custom. It's the one component with real domain logic in its rendering, and stock primitives will fight it
- Dark mode, since `color-scheme: light dark` is already declared and currently does nothing
- Accessibility pass: this is the payoff for choosing Base UI, so actually collect it — keyboard paths through the hold and entry flows, focus management on the live-updating grid

**Exit criteria:** no hand-rolled CSS files remain in `apps/web` outside `globals.css` and the occupancy grid. Both apps work in light and dark. Nothing in `packages/` changed during this phase — if something did, D18's premise was wrong and it's worth understanding why.

## Phase 9+ — Only after all of the above

In rough order of value: vehicle types and EV spots → pricing model with no payment processing → analytics over the event log (it's already there) → public read API → external providers → payments.

**Deferred infrastructure, with explicit triggers:**

| Introduce                                       | Only when                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| Dedicated fan-out process, or Supabase Realtime | Phase 7's load test says you're near the connection ceiling           |
| Redis                                           | Genuine cross-request caching need, measured                          |
| Read replicas                                   | Read load actually hurts                                              |
| Partitioning `parking_event`                    | The table passes ~50M rows                                            |
| Leaving serverless entirely                     | Connection limits, not duration limits, become the binding constraint |
| Anything Kubernetes                             | Never, for this project                                               |

---

# Part 3 — Resolved, Corrected, and Still Open

**Corrected: SSE on Vercel.** I previously claimed serverless made `LISTEN/NOTIFY` + SSE unworkable and routed around it to Supabase Realtime. That was overstated. SSE is supported, Fluid compute gives 300s on Hobby and up to 800s on Pro, and `EventSource` reconnects automatically with `Last-Event-ID` resume. Since this design streams invalidation hints rather than state, periodic reconnection is a non-event. The real ceiling is Postgres session connections per open stream, and that's a Phase 7 measurement, not a Phase 1 blocker. Building the transport yourself is now both viable and the higher-learning path — take it.

**Corrected: the terminal.** Browser tab was right for weekends, wrong for full-time. Standalone Node process, SQLite queue on disk. See the sizing note above.

**Deployment: Vercel + Supabase.** Resolved. Note the connection-string discipline in D3b — it is the single most likely thing to cost you a confusing afternoon in week one.

**Auth: Better Auth.** Resolved. Sessions live in the same Postgres as the tenancy model, so operator scoping and RLS compose instead of being bridged. Devices authenticate separately with operator-issued tokens.

**Resolved: dependency policy.** Latest stable everything, upgraded in isolated commits (D17). The Next 16, zod 4, drizzle 0.45, vitest 4, and fast-check 4 upgrades already landed that way.

**Resolved: the UI stack.** shadcn/ui on Base UI, adopted after Phase 7 as its own phase (D18). Not Radix, and not early.

**Resolved: `packages/api` exists.** D13 said split further only when a boundary demonstrably hurts. It hurt in Phase 3, when the terminal would otherwise have had to depend on `apps/web` for procedure types. Five workspaces now, not four.

**Still genuinely open, and fine to defer:**

- Whether the zone counter should be a denormalized column (as in D4) or a computed aggregate. The counter is faster and the `CHECK` protects it; the aggregate cannot drift. This question is now answerable — `counter-reconciliation.test.ts` has been running in CI since Phase 2. If it has stayed green, drift isn't real under the current write paths and the column stays. Worth closing explicitly rather than leaving open by inertia, with one caveat: Phase 5 adds replay and snapshot correction, which are new ways to write the counter. Re-check after Phase 5 before calling it settled.
- Whether snapshots (D11) should be full-facility or per-zone. Full is simpler; 120 rows is nothing. Per-zone matters only at a scale this project won't reach.
- Whether to keep the SSE transport or move to a dedicated fan-out process at the end of Phase 7. Deliberately deferred to a measurement rather than a preference — that's what Phase 7's load test is for.
