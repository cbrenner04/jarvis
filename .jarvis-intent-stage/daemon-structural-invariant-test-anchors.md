---
name: daemon-structural-invariant-test-anchors
---

# Re-key daemon structural-invariant tests to behavioral anchors

## Problem

Daemon structural-invariant tests anchor invariants to incidental structure — hand-maintained module file lists, exact title-count equality, symbol-name section pins — so legitimate extractions and renames red-gate while the guarded admission or inventory property still holds.

## Behavior

- Re-key every daemon structural-invariant test the audit tagged `re-key` to its source of truth: resolved symbol sets, discovered file globs, missing-only inventory semantics, or property assertions over admission routing.
- Adopt shared loud-failure locators for section and symbol slicing; pair absence assertions with presence when the invariant is "this moved".
- Leave `stay-incidental` anchors unchanged except to route through loud-failure locators.

## Decision ledger

- Inventory guards assert missing titles or paths only, not exact count equality with merge-base; rules out blocking net-new co-located tests that add coverage without dropping merge-base titles.
- Symbol location discovers owning modules from a glob or export surface, not a hand-maintained filename list; rules out pins that break on legitimate renames or module moves.
- Move invariants pair absence in the old home with presence in the new home; rules out one-way absence checks that pass on outright deletion.

## Prerequisites

- `v2/docs/structural-invariant-test-audit.md` catalogs structural-invariant tests and classifies each anchor.
- Shared structural-invariant locators throw named errors when the subject cannot be located.
- Every `shared/**` structural-invariant test tagged `re-key` in the audit anchors on its source of truth.

## Primary implementation surface

- `v2/src/daemon/`

## Acceptance criteria

- [ ] Every daemon structural-invariant test tagged `re-key` in `v2/docs/structural-invariant-test-audit.md` anchors on its source of truth or documents `stay-incidental` unchanged.
- [ ] `daemon-workflow-start.test.ts` and `daemon-test-inventory.test.ts` stay green when a co-located daemon test file is added without renaming merge-base titles.
- [ ] `daemon-workflow-start.test.ts` — `workflow starts, pipeline dispatch, and recovery share daemon admission` stays green after a symbol rename that preserves admission routing.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass for the daemon slice.

## Documentation updates

- None — patterns land in `v2/docs/test-writing.md` via a later intent.
