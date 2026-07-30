---
name: pipeline-store-enumeration
---

# Enumerate durable pipelines and stages

## Prerequisites

- Validated pipeline admission durably creates one pipeline record and ordered stage records.

## Problem

The state store can load one known pipeline but cannot enumerate pipelines for an operator listing.

## Decisions

- Add one repository operation that returns admitted pipelines with their ordered stage records; rules out daemon or CLI SQL access.
- Keep derived pipeline state outside persistence; rules out making the state store interpret daemon-owned stage transitions.
- Deferred to first consumer: enumeration ordering, retention, and filters — pin when the daemon query contract needs them.

## Acceptance criteria

- [ ] Multiple admitted pipelines can be enumerated with each pipeline's complete stages in authored order.
- [ ] Enumeration preserves stage ID, status, and workflow invocation ID after closing and reopening the store.
- [ ] A regression in `v2/src/persistence/state-store.test.ts` fails before this behavior and passes after it.

## Documentation updates

- `v2/docs/state-store.md` — pipeline enumeration repository contract and its lifecycle-interpretation boundary.
