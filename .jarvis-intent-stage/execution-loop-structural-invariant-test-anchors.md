---
name: execution-loop-structural-invariant-test-anchors
---

# Re-key execution-loop structural-invariant tests to behavioral anchors

## Problem

Execution-loop structural-invariant tests anchor invariants to line numbers, copied registry literals, hardcoded observer lists, and one-way absence checks, so sound extractions in the workflow-runner and write-loop chains red-gate or pass vacuously.

## Behavior

- Re-key every execution-loop structural-invariant test the audit tagged `re-key` to its source of truth: registry resolvers, semantic call-site keys, merge-base missing-only inventory, or property assertions over scoping.
- Adopt shared loud-failure locators; pair absence with presence when the invariant is "this moved".
- Leave `stay-incidental` anchors unchanged except to route through loud-failure locators.

## Decision ledger

- Settlement and guard inventories key on semantic identity `(file, writer, functionName)` or equivalent, not line numbers; rules out line-keyed inventories that break on unrelated merges.
- Registry-backed lists resolve through the owning module (`resolveRenderObserverTests`, permitted-write maps), not copied literals; rules out hardcoded lists that fail when the registry grows.
- Move invariants pair absence in the old home with presence in the new home; rules out one-way absence checks that pass on outright deletion.

## Prerequisites

- `v2/docs/structural-invariant-test-audit.md` catalogs structural-invariant tests and classifies each anchor.
- Shared structural-invariant locators throw named errors when the subject cannot be located.
- Every `shared/**` structural-invariant test tagged `re-key` in the audit anchors on its source of truth.
- Daemon structural-invariant tests tagged `re-key` in the audit anchor on their source of truth.
- CLI structural-invariant tests tagged `re-key` in the audit anchor on their source of truth.

## Primary implementation surface

- `v2/src/execution/`

## Acceptance criteria

- [ ] Every execution-loop structural-invariant test tagged `re-key` in `v2/docs/structural-invariant-test-audit.md` anchors on its source of truth or documents `stay-incidental` unchanged.
- [ ] `execution-terminal-settlement-guard.test.ts` — `inventory ignores line drift above tracked call sites` stays green when tracked call sites shift line numbers without changing writer identity.
- [ ] `diff-derived-mutation-verifier.test.ts` observer scoping assertions resolve expected observers through `resolveRenderObserverTests`, not a hardcoded literal list.
- [ ] `workflow-runner-resume-structure.test.ts` pairs absence from `workflow-runner.ts` with presence in `workflow-runner-resume.ts` for every extracted helper.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass for the execution-loop slice.

## Documentation updates

- None — patterns land in `v2/docs/test-writing.md` via a later intent.
