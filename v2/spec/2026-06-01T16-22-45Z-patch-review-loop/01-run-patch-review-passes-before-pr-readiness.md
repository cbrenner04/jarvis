# 01 - Run patch review passes before PR readiness

## Problem

Patch mode goes straight from completion to readiness.

## Decisions

Run review only after zero unchecked boxes and a clean worktree, never interleaved with implementation.
Two gates bracket the passes: `bun run ready` (baseline) → passes → `bun run ready` → `gh pr ready`. No per-pass validation.
The baseline gate is its own helper — `maybeMarkReady` minus `gh pr ready`: runs `bun run ready`, commits/pushes any `check:fix` output, leaves the PR draft, guarantees a clean worktree before pass 1. (Reusing `maybeMarkReady` readies too early; calling only `bun run ready` leaves `check:fix` dirty.)
The active spec tree (`index.md` + linked subspecs) is read-only during review — no edits to checklist, prose, docs, or acceptance text. The harness enforces this (plan mode's write-boundary check, inverted); an offending pass is reverted/rejected, not committed.
Review does not consume `maxIterations` — do not exit `5` before review runs.
Each prompt gets the completed spec tree plus the branch PR/base diff, not a merge-base-only diff that can miss shipped changes.
Run all `N` passes unless a blocker, quota stop, or hard error halts the run; do not stop on the first no-op.
Non-empty passes commit as `review <N>` and refresh the PR body (attribution footer only, no description regen); no-op passes do not commit.
Blocker: post a PR comment via a new `gh pr comment` helper, commit the pass's changes, keep the PR draft, exit `7`, write no `## Blocker` into specs. (The PR exists by review time; a failed post is a generic error; no dedup.)
Review-agent quota exhaustion mid-phase: exit `2`, leave the PR draft — no fall-through to other modes, no auto-ready.

## Task Checklist

- [ ] Add a `prompts/patch/review.md` template that mirrors plan review's subtractive bias, forbids any edit to the active spec tree, and scopes work to the completed spec.
- [ ] Add prompt assembly and diff-snapshot plumbing so each pass receives the current spec tree and the branch PR/base diff.
- [ ] Add the baseline-gate helper (`maybeMarkReady` minus `gh pr ready`).
- [ ] Insert the review phase into `jarvis1 run` after completion + clean-tree validation: baseline gate → `N` passes (unless an allowed stop fires) → existing `maybeMarkReady`.
- [ ] Enforce the spec-tree read-only boundary during passes (revert/reject any pass that edits a spec file).
- [ ] Reuse patch-mode agent classification and fallback for passes — no review-only outcome kinds or exit codes; quota exhaustion exits `2`, PR left draft.
- [ ] Commit non-empty passes with the `Jarvis-Agent:` trailer and the attribution-footer refresh; leave no-op passes uncommitted.
- [ ] Add a `gh pr comment` helper in `v1/src/gh.ts` and blocker handling: post the comment, commit the pass work, leave the PR draft, exit `7`, write no `## Blocker`.
- [ ] Share the `bun run ready` + `check:fix` commit logic between the baseline helper and `maybeMarkReady` (which keeps the `gh pr ready` transition) rather than duplicating it.
- [ ] Add/update tests for: gate ordering, the baseline gate committing `check:fix` while leaving PR draft + clean worktree, the read-only boundary, no-op passes, blocker exit (`7`, comment posted), quota exhaustion (`2`, draft), commit shape, and `maxIterations` separation.

## Documentation updates

- [ ] Update inline docs near patch prompt assembly, completion, or PR-ready helpers where the new phase changes their contract.

## Acceptance criteria

- [ ] In `git: true` runs, after completion + clean worktree, `jarvis1 run` runs `bun run ready` → review passes → `bun run ready` → `gh pr ready`.
- [ ] Passes use the completed spec tree and branch PR/base diff; the spec tree is read-only and a pass editing any spec file is reverted/rejected.
- [ ] The baseline gate runs `bun run ready`, commits/pushes any `check:fix`, leaves the PR draft, and leaves a clean worktree before pass 1.
- [ ] A pass that edits files makes one `review <N>` commit and refreshes the draft PR body; a no-op pass makes no commit.
- [ ] Review continues through pass `N` even after an earlier no-op.
- [ ] A blocker posts a PR comment, commits that pass's changes, leaves the PR draft, exits `7`, and writes no `## Blocker` into any spec file.
- [ ] Review passes still run after the checklist-closing iteration even when `maxIterations` is exhausted.
- [ ] When every review-order agent is quota-exhausted, the run exits `2` and the PR is left draft.
