---
name: routing-action-catalog-and-validation
---

# A closed routing action catalog validates translated requests before dispatch

## Problem

Free-text routing treats model output as untrusted input, and nothing in the harness today defines the closed set of actions a router may select or validates typed arguments against it.

## Decisions

- The catalog is a closed whitelist of high-level actions with strict per-action argument schemas; plan must decide the initial actions and their exact required arguments (start small, grow from operator usage).
- Validation rejects unknown actions, extra fields, missing required fields, type mismatches, arbitrary command strings, and executable payloads; no coercion, no partial acceptance.
- Validation is pure: it returns a typed action for dispatch or a named rejection, and performs no I/O.

## Prerequisites

## Acceptance criteria

- [ ] `free-text-routing-actions.test.ts`: a request matching a catalog action and schema validates to a typed action; unknown action, extra field, missing required field, wrong type, and command-string payloads are each rejected with a named reason; fails against current code (no catalog).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — routing as a translation, validation, and dispatch layer over canonical operations; the catalog as the validation boundary.

## Primary implementation surface

- `v2/src/cli/free-text-routing-actions.ts` (new)
