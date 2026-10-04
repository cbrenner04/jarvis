# Migrate execution inline Git and GitHub spawns

## Problem

`v2/src/execution/` production modules still call `runAsync("git", …)` directly and several still build `gh` argv outside `github-operations.ts`. The guard must pass on the full execution tree except the GitHub boundary owner.

## Decision ledger

- In-scope: every `v2/src/execution/*.ts` production module that contains `runAsync("git"` or non-allowlisted `runAsync("gh"` on the prerequisite base, including at minimum `write-loop.ts`, `workflow-runner.ts`, `workflow-runner-debate-landing.ts`, `spec-run-body-summary.ts`, `review-intent-enforcement.ts`, `ready-finalize.ts`, `main-sync-scope.ts`, `iteration-head-guard.ts`, `intent-output.ts`, `implement-workflow-steps.ts`, `diff-scan.ts`, `pr-body-refresh.ts`, and `review-feedback-admission-prelude.ts`; rules out leaving stragglers for a follow-on intent once this subspec completes.
- Out of scope for edits: `v2/src/execution/github-operations.ts` (sole `gh` spawn owner); test files and `*.test-support.ts`.
- Default git seam parameters that currently default to inline `runAsync("git", …)` (for example in `spec-run-body-summary.ts`) default to delegating through `shared/git.ts` helpers or an injected git callback typed to the boundary; rules out retaining a production default that spawns git literals.
- `external-worktree.ts` `materializeReadCheckout` archive pipe: migrate to a typed shared export if one exists after prerequisite work; otherwise keep a single marked `guard-git-spawn-bypass:` call with rationale naming streaming archive; rules out unmarked archive bypass.

## Prerequisites

- Subspec [01](./01-migrate-daemon-and-commands-inline-spawns.md) merged.

## Task checklist

- Eliminate forbidden spawns in each in-scope execution file; extend `shared/git.ts` or `github-operations.ts` when argv is not yet covered.
- Migrate `pr-body-refresh.ts`, `ready-finalize.ts`, and `review-feedback-admission-prelude.ts` off inline `gh` to `github-operations.ts` exports.
- Run `runGitSpawnBypassGuard` locally until only `github-operations.ts` contains `runAsync("gh"` and no production file contains unmarked `runAsync("git"`.

## Acceptance criteria

- [x] `runGitSpawnBypassGuard` reports zero violations across all `v2/src/execution/` production modules; fails against the pre-fix tree where `v2/src/execution/write-loop.ts` still contains `runAsync("git",`.
- [x] `scripts/guard-git-spawn-bypass.test.ts` test `rejects deliberate new git spawn fixture` (or equivalent) fails when a synthetic production record adds a fresh `runAsync("git"` line and passes when the guard flags it — pins regression detection for new bypasses.
- [x] `write-loop-coverage-and-iteration-commit.test.ts` stays green.
- [x] `github-operations.test.ts` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- None (architecture doc updates in subspec 03).
