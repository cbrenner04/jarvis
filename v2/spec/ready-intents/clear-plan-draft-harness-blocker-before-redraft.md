---
name: clear-plan-draft-harness-blocker-before-redraft
---

# Clear plan-draft harness blockers before redraft

## Problem

- A normalizer rejection leaves a harness-authored `Artifact contract check failed:` blocker in staged `intent.md`; a later passing redraft is misclassified as an agent prerequisite blocker and fails `plan.draft.blocker` with stale diagnostics.

## Module-boundary surface

- Execution loop: plan-draft attempt preparation, staged normalization diagnostics, and blocker-contract evaluation share this boundary; splitting does not apply because no persistence, daemon, or CLI behavior changes.

## Prerequisites

## Decisions

- Strip each staged `## Blocker` section whose body starts with `Artifact contract check failed:` before rendering the next plan-draft prompt; rules out retaining stale harness text in `intent.md`.
- Carry every stripped harness reason into the redraft prompt through plan-draft diagnostic context in staged-file order; rules out hiding or reordering actionable rejection diagnostics.
- Keep `hasGenuineBlocker` and agent-authored blocker handling unchanged, including when a staged file contains both harness and agent blockers; rules out prefix exceptions in the shared parser and preserves `plan.draft.blocker` for genuine blockers.

## Acceptance criteria

- [ ] A regression test fails against the current pass-through and proves that a valid plan redraft after multiple prior harness `Artifact contract check failed:` blockers does not settle `plan.draft.blocker`, receives every prior reason in staged-file order in its prompt, and leaves staged `intent.md` without those harness blockers.
- [ ] An existing or new test proves that an agent-authored `## Blocker` on staged `intent.md`, including alongside a harness blocker, still settles `plan.draft.blocker`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` documents that harness-authored staged blockers are cleared before the next plan-draft prompt, remain available as ordered redraft diagnostics, and never count as genuine blockers even alongside an agent blocker.
- `v2/docs/v1-behaviors.md` aligns the plan-draft normalizer rejection diagnostics entry with the cleared-file, ordered redraft-prompt, and mixed-blocker behavior.
