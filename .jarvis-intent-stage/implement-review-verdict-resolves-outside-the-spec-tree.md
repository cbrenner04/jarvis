---
name: implement-review-verdict-resolves-outside-the-spec-tree
---

# The implement review verdict resolves to a harness sidecar, not the spec tree

## Problem

`buildImplementWorkflowSteps` (`v2/src/execution/implement-workflow-steps.ts`) resolves the review verdict to `join(dirname(launchSpecPath), "verdict-patch.md")` — inside the published spec tree directory (`v2/spec/<timestamp>-<name>/`), whose entire contents are committed and later archived to `completed/`. `#3578` shipped one onto `main`; the 2026-09-08 `stamp-gate-commands-on-gate-running-steps` implement shipped another. Every other review artifact lives in a harness sidecar path.

## Decisions

- The implement verdict resolves to a harness sidecar directory at the worktree root, sibling to the other `.jarvis-*` stages, rather than to the spec directory; rules out writing harness state into a directory whose entire contents are committed and archived.
- The path stays deterministic per run so the review cycle, the retry/actuator read of `priorCycleVerdict`, and the ownership marker (`<verdictPath>.owner`) all resolve to the same file; rules out a per-cycle temp path that breaks verdict-dependent retry.
- The sidecar directory is created by the step builder or review cycle before first write; rules out relying on the spec dir having already existed.
- Landing and archival semantics are untouched — the verdict is never committed in the first place; rules out teaching `cleanup` to strip verdicts during archival.

## Acceptance criteria

- [ ] A test asserts the built implement workflow's review step `verdictPath` is outside the spec directory, under the harness sidecar path; it fails against the pre-fix builder.
- [ ] A test asserts the same resolved `verdictPath` is used by both the light and debate review step shapes.
- [ ] A test asserts the verdict written during a review cycle is readable at the resolved path on the next cycle, so `priorCycleVerdict` retry still works.
- [ ] A test asserts a completed reviewed implement's published tree contains no `verdict-*.md`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the review verdict is harness state, never published spec content; name its resolved sidecar path.
- `v2/docs/operator-runbook.md` — drop the hand-publish instruction to strip `verdict-*.md`, and the note in the multi-subspec publication gotcha.
- `v2/docs/v1-behaviors.md` — record that implement no longer writes its verdict into the spec tree.

## Prerequisites

- The completion commit excludes `verdict-*.md` from staging for every landing kind.
- `verdict-*.md` is gitignored in this repo.
