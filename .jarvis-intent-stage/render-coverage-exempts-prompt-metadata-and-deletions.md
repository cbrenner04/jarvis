---
name: render-coverage-exempts-prompt-metadata-and-deletions
---

# Render-coverage exempts prompt metadata bumps and pure deletions

Unsplit rationale: Metadata/deletion exemptions, sentinel-mutation enforcement for real body changes, regressions, and durable documentation all live on the execution-loop diff-derived mutation verifier surface; no persistence, daemon, or CLI boundary changes.

## Primary implementation surface

- Execution-loop diff-derived mutation verification in `v2/src/execution/`

## Prerequisites

- Render-coverage resolves observer test scope from `shared/prompts/render-observer-tests.ts` under the verification worktree at verification time.
- Changed registered prompts require a present, non-empty mapped observer entry and green observer tests before render-coverage passes.

## Problem

- Render-coverage requires a mapped observer test to kill a sentinel mutation on every changed prompt line; frontmatter-only bumps (e.g. `revision`) and pure body deletions have no post-change line to mutate, so correct prompt dedups strand at `missing-render-coverage` despite green observer tests with exact-once assertions.

## Behavior

- A registered-prompt diff whose only changes are frontmatter/metadata (lines before the body `---` delimiter) passes render-coverage when its observer entry is present and green.
- A registered-prompt diff whose only body changes are deletions passes render-coverage when its observer entry is present and green; absence/exact-once coverage is enforced by the observer suite, not per-deleted-line mutation.
- A registered-prompt diff that adds or changes a body line still requires the mapped observer test to fail under the sentinel body-line mutation.

## Decision ledger

- Skip render-coverage sentinel mutation for changed lines above the body `---` delimiter; rules out requiring observer tests to assert revision/id/behavior/placeholders literals.
- Treat deletion-only body diffs as render-coverage satisfied when the mapped observer suite is present and green; rules out mutating deleted regions that no longer exist in the post-change source.
- Keep fail-closed `missing-render-coverage` for added/changed body lines whose mapped observer test passes under the sentinel mutation; rules out exempting real prompt-behavior edits.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts` proves a registered-prompt diff that only bumps frontmatter `revision` passes render-coverage (no `missing-render-coverage`); fails against the pre-fix verifier.
- [ ] `diff-derived-mutation-verifier.test.ts` proves a registered-prompt diff that only deletes body lines passes render-coverage when the mapped observer entry is present and green; fails against the pre-fix verifier.
- [ ] `diff-derived-mutation-verifier.test.ts` proves a registered-prompt diff that adds or changes a body line still returns `missing-render-coverage` when the mapped observer test does not catch the sentinel mutation.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification — metadata/deletion render-coverage exemptions.
- `v2/docs/operator-runbook.md` — `missing-render-coverage` recovery note for metadata-only and deletion-only prompt diffs.
- `v2/docs/v1-behaviors.md` — record render-coverage metadata/deletion exemption behavior.
