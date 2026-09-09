# Implement review verdict resolves to a worktree-root harness sidecar

## Problem

`buildImplementWorkflowSteps` (`v2/src/execution/implement-workflow-steps.ts:752`) resolves the review verdict to `join(dirname(launchSpecPath), "verdict-patch.md")` — inside the published spec tree (`v2/spec/<timestamp>-<name>/`), whose whole contents are committed and later archived to `completed/`. Two verdicts have already shipped onto `main` that way (`#3578`; the 2026-09-08 `stamp-gate-commands-on-gate-running-steps` implement). Staging exclusions (`completionStageArgs`) and `.gitignore` already treat `verdict-*.md` as transient, so the fix is to stop resolving the path into published territory at all; every other review flavor already writes to a harness sidecar.

## Decisions

- The implement verdict resolves to `<cwd>/.jarvis-implement-review/verdict-patch.md`, where `cwd` is the review step's resolved implement worktree root; rules out keeping harness state in a directory whose entire contents are committed and archived.
- The path is derived from the worktree root only, never from `launchSpecPath`; rules out an external-spec launch relocating the verdict beside a spec tree outside the worktree.
- Both the `review` (light) and `review-debate` step shapes take the identical resolved path from one builder-local binding; rules out drifting per-shape paths.
- The path stays constant for the whole run, so the review cycle, the `priorCycleVerdict` retry read, and the `<verdictPath>.owner` ownership marker resolve to the same file; rules out a per-cycle temp path that breaks actuator-only retry.
- The sidecar directory is created recursively at verdict-write time in the review executors rather than in the builder; rules out relying on a directory existing before the worktree is materialized, and covers resume/retry dispatch paths that skip the builder.
- Landing and archival semantics are untouched — the verdict is never committed in the first place; rules out teaching `cleanup` to strip verdicts during archival.
- The basename stays `verdict-patch.md`; rules out a rename that would fall outside the existing `verdict-*.md` gitignore, staging-exclusion, and idle-watchdog sidecar rules.

## Task checklist

- [ ] Resolve `verdictPath` from the review-step `cwd` into `.jarvis-implement-review/` in `buildImplementWorkflowSteps`.
- [ ] Create the verdict's parent directory before the first write in both review executors.
- [ ] Add the tests named in the acceptance criteria.
- [ ] Update the three docs below.

## Acceptance criteria

- [x] A test asserts the built implement workflow's review step `verdictPath` equals `<worktree>/.jarvis-implement-review/verdict-patch.md` and is outside the spec directory; it fails against the pre-fix builder.
- [x] A test asserts the light `review` and the `review-debate` step shapes resolve the same `verdictPath`.
- [x] A test asserts a verdict written during one review cycle is readable at the resolved path on the next cycle, so `priorCycleVerdict` retry still works; it fails against the pre-fix code if the path were per-cycle.
- [x] A test asserts a completed reviewed implement's published tree contains no `verdict-*.md` entry.
- [x] A test asserts the verdict write succeeds when `.jarvis-implement-review/` does not yet exist; it fails against the pre-fix executors.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — the implement review verdict is harness state at `<worktree>/.jarvis-implement-review/verdict-patch.md`, never published spec content; correct the "beside the executed index" and external-spec "placed beside the absolute external spec path" statements.
- `v2/docs/operator-runbook.md` — drop the hand-publish instruction to strip `verdict-*.md` in the multi-subspec publication gotcha.
- `v2/docs/v1-behaviors.md` — record that implement review no longer writes its verdict into the spec tree.
