---
name: structural-invariant-test-writing-docs
---

# Document structural-invariant test authoring rules

## Problem

Authors keep copying brittle structural-invariant shapes — line-keyed inventories, copied registry literals, hand-maintained file lists, vacuous section pins — because `v2/docs/test-writing.md` has no guidance on anchoring invariants to behavior.

## Behavior

- Add a `v2/docs/test-writing.md` section on structural-invariant tests covering: assert the property not the arrangement, anchor on the source of truth, fail loudly when the subject cannot be located, pair absence with presence for moves, and reference the audit artifact for the current corpus.

## Decision ledger

- Authoring rules live in `v2/docs/test-writing.md` as the durable home; rules out duplicating the full rule set only inside the audit artifact.
- Guidance cites `v2/docs/structural-invariant-test-audit.md` for the live inventory; rules out a second hand-maintained test list in docs.

## Prerequisites

- `v2/docs/structural-invariant-test-audit.md` catalogs structural-invariant tests and classifies each anchor.
- Shared structural-invariant locators throw named errors when the subject cannot be located.
- Every `shared/**` structural-invariant test tagged `re-key` in the audit anchors on its source of truth.
- Daemon structural-invariant tests tagged `re-key` in the audit anchor on their source of truth.
- CLI structural-invariant tests tagged `re-key` in the audit anchor on their source of truth.
- Execution-loop structural-invariant tests tagged `re-key` in the audit anchor on their source of truth.

## Primary implementation surface

- `v2/docs/test-writing.md`

## Acceptance criteria

- [ ] `v2/docs/test-writing.md` contains a structural-invariant tests section covering property-first assertions, source-of-truth anchoring, loud locator failure, absence/presence pairing, and a pointer to `v2/docs/structural-invariant-test-audit.md`.
- [ ] `bun run typecheck` passes.

## Documentation updates

- `v2/docs/test-writing.md` — structural-invariant test section (this intent's deliverable).
