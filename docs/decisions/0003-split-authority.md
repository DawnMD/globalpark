# ADR 0003: Split authority between facility and network

## Status
Accepted

## Context
Two different kinds of truth exist in this system: what is physically true
at a facility (a car is in a bay or it isn't), and what is logically true
across the network (reservations, identity, pricing). These can disagree —
most sharply during offline terminal replay (Phase 5), when a facility
reports physical events that happened while disconnected from the network's
view of the world.

## Decision

| Concern | Authority | Rule on conflict |
|---|---|---|
| Physical occupancy | The facility | Facility wins, always. |
| Reservations, identity, pricing | The network | Server wins. Only it sees all users. |

Physical events (`entry.detected`, `exit.detected`) are applied
unconditionally on reconciliation and may trigger compensating actions — an
honored reservation that can no longer be honored becomes a refund or a
relocation, never a rejected event. Logical events yield to server state.

## Consequences
- Reconciliation logic (Phase 5) has a fixed rule to apply per event type
  instead of adjudicating case by case.
- Compensating-action paths (refund, relocation) are a required part of the
  reservation domain, not an edge case bolted on later.
- Snapshot ingest (D11) is the mechanism that makes facility authority
  concrete: derived occupancy state is overwritten wholesale from the
  facility's snapshot, not merged.
