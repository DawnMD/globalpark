# ADR 0002: Reservations are capacity holds, not spot claims

## Status
Accepted

## Context
A reservation could either name a specific physical spot (e.g. bay A102) or
hold a unit of capacity in a zone, with the physical spot assigned at the
gate. Naming a specific bay is how naive designs work, but it has no
enforcement mechanism against a stranger physically parking in that bay
before the reservation holder arrives.

## Decision
A reservation holds a unit of capacity in a `parking_zone`, not a specific
`parking_spot`. The physical spot is assigned at the gate when a session
starts.

Enforced via hot-row contention on the zone counter, not per-row locking:

```sql
UPDATE parking_zone
   SET held_count = held_count + 1
 WHERE id = $1
   AND held_count + occupied_count < capacity
RETURNING id;
```

Zero rows returned = CONFLICT. Backed by
`CHECK (held_count + occupied_count <= capacity)` so the invariant holds even
if application code has a bug.

## Consequences
- `parking_spot.status` is physical-occupancy-only, written exclusively by
  terminal/sensor events (ADR 0003, D5). `RESERVED` does not exist as a spot
  state.
- The concurrency problem to solve is hot-row contention on a counter, not
  row locking — this is deliberately the more interesting variant to
  implement and test (D15's 200-way adversarial test targets exactly this).
- A stranger parking in "your" bay is a non-event: the gate just assigns a
  different physical spot from the same zone's available pool.
