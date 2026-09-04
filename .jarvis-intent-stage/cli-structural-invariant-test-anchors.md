---
name: cli-structural-invariant-test-anchors
---

# Re-key CLI structural-invariant tests to behavioral anchors

## Problem

CLI structural-invariant tests read production source and pin symbol ownership across modules with hand-maintained paths, so extractions that preserve CLI behavior still red-gate the suite.

## Behavior

- Re-key every CLI structural-invariant test the audit tagged `re-key` to resolved symbols, discovered module sets, or property assertions over the CLI contract.
- Adopt shared loud-failure locators for source slicing; pair absence with presence when the invariant is "this moved".

## Decision ledger

- Symbol ownership resolves through exports or discovered file sets, not a fixed path list; rules out pins invalidated by module moves that preserve the CLI surface.
- Move invariants pair absence in the old home with presence in the new home; rules out one-way absence checks.

## Prerequisites

- `v2/docs/structural-invariant-test-audit.md` catalogs structural-invariant tests and classifies each anchor.
- Shared structural-invariant locators throw named errors when the subject cannot be located.
- Every `shared/**` structural-invariant test tagged `re-key` in the audit anchors on its source of truth.
- Daemon structural-invariant tests tagged `re-key` in the audit anchor on their source of truth.

## Primary implementation surface

- `v2/src/commands/`

## Acceptance criteria

- [ ] Every CLI structural-invariant test tagged `re-key` in `v2/docs/structural-invariant-test-audit.md` anchors on its source of truth or documents `stay-incidental` unchanged.
- [ ] `workflow.test.ts` and `workflow-start-preparation.test.ts` structural pins stay green when guarded symbols move to a sibling module without changing CLI behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass for the CLI slice.

## Documentation updates

- None — patterns land in `v2/docs/test-writing.md` via a later intent.
