# 01 - Run patch review passes before PR readiness

## Problem

Patch mode goes straight from completion to readiness.

## Decisions

Run patch review only after zero unchecked boxes and a clean worktree, not interleaved with implementation iterations.
The readiness gate brackets the loop: `bun run ready` runs once after completion (green baseline), then the passes, then `bun run ready` again, then `gh pr ready`. No per-pass validation; the two gates bracket the loop.
The pre-review baseline gate is its own helper — `maybeMarkReady` minus the `gh pr ready` step: it runs `bun run ready`, commits and pushes any `check:fix` output, leaves the PR draft, and guarantees a clean worktree before pass 1. Reusing `maybeMarkReady` (marks ready too early) or calling only `bun run ready` (leaves `check:fix` dirty) are the wrong alternatives.
The active spec tree (`index.md` + linked subspecs) is read-only during review: passes must not edit any spec file — not the checklist, prose, docs sections, or acceptance text. The harness enforces this (inverse of plan mode's write-boundary check); a pass that touches a spec file is reverted/rejected, not silently committed.
Patch review does not consume `maxIterations`; do not exit `5` after the checklist-closing implementation pass before review runs.
Each review prompt includes the completed spec tree plus the branch PR/base diff, not a merge-base-only diff that can miss shipped changes.
Run configured passes through `N` unless a blocker, quota stop, or existing hard error stops the run; do not stop on the first no-op pass.
Non-empty review passes commit as `review <N>` and trigger the standard attribution-footer PR-body refresh (footer only — not a description regeneration); no-op passes do not commit.
On a review blocker, post a PR comment via a net-new `gh pr comment` helper, commit that pass's changes, keep the PR draft, exit `7`, and do not write `## Blocker` into spec files. The PR is guaranteed to exist by review time (the run exits earlier otherwise); a failed comment post is a generic error (no new exit code); no dedup (patch runs are fresh per invocation).
On review-agent quota exhaustion mid-phase, exit `2` (mirroring patch-mode exhaustion) and leave the PR draft; do not fall through to another mode's agents and do not auto-ready.

## Task Checklist

- [ ] Add a patch review prompt template at `prompts/patch/review.md` that mirrors plan review's subtractive bias, forbids any edit to the active spec tree (read-only — not just the checklist), and scopes review work to the completed spec.
- [ ] Add prompt assembly and diff snapshot plumbing for patch review so each pass receives the current spec tree and the branch diff against the PR/base comparison range.
- [ ] Add a baseline-gate helper (`maybeMarkReady` minus `gh pr ready`) that runs `bun run ready`, commits and pushes any `check:fix` output, leaves the PR draft, and leaves the worktree clean.
- [ ] Insert a deterministic review phase into `jarvis1 run` after completion detection and clean-tree validation: run the baseline gate, then exactly the configured number of passes unless an allowed stop condition fires, then the existing `maybeMarkReady` (ready + `gh pr ready`).
- [ ] Enforce the spec-tree read-only boundary during review passes (revert/reject any pass that edits a spec file), mirroring plan mode's write-boundary check inverted.
- [ ] Reuse existing patch-mode agent classification and fallback semantics for review passes instead of inventing review-only outcome kinds or exit codes; on review-agent quota exhaustion, exit `2` with the PR left draft.
- [ ] Commit non-empty review passes with the standard `Jarvis-Agent:` trailer and the standard attribution-footer PR-body refresh, and leave no-op passes uncommitted.
- [ ] Add a `gh pr comment` helper in `v1/src/gh.ts` and blocker handling for patch review that posts the blocker as a PR comment, commits the pass work, leaves the PR draft, and exits `7` without writing `## Blocker` into any spec file.
- [ ] Keep the existing `maybeMarkReady` as the post-review gate (it owns the `gh pr ready` transition and any `check:fix` follow-up commit); the baseline helper and `maybeMarkReady` share the `bun run ready` + `check:fix` commit logic rather than duplicating it.
- [ ] Add or update tests for ordered execution (baseline ready → passes → ready → `gh pr ready`), the baseline gate committing `check:fix` while leaving the PR draft + worktree clean, the spec-tree read-only boundary, no-op passes, blocker exits (PR comment posted, exit `7`), quota exhaustion (exit `2`, PR draft), review-pass commit shape, and the separation from `maxIterations`.

## Documentation updates

- [ ] Update inline docs near patch prompt assembly, completion, or PR-ready helpers where the new phase changes their contract.

## Acceptance criteria

- [ ] In normal `git: true` patch runs, after the checklist is complete and the worktree is clean, `jarvis1 run` runs `bun run ready` (baseline), then the configured review passes, then `bun run ready` again, then `gh pr ready`.
- [ ] Review passes use the completed spec tree and the branch PR/base diff as prompt inputs; the active spec tree is read-only and a pass that edits any spec file is reverted/rejected rather than committed.
- [ ] The pre-review baseline gate runs `bun run ready`, commits and pushes any `check:fix` output, leaves the PR draft (no `gh pr ready`), and leaves the worktree clean before pass 1.
- [ ] A review pass that edits files creates one harness commit on the patch branch with subject `review <N>` and refreshes the draft PR body; a pass with no file changes creates no commit.
- [ ] Patch review continues through pass `N` even if an earlier pass is a no-op.
- [ ] A blocker raised during patch review posts a PR comment, commits that pass's changes, leaves the PR draft, exits with the existing blocker code `7`, and does not write `## Blocker` into any spec file.
- [ ] Review passes still run after the checklist-closing implementation iteration even when `maxIterations` would otherwise be exhausted by that point.
- [ ] When every agent in the review order is quota-exhausted during the review phase, the run exits `2` and the PR is left draft (not marked ready).
