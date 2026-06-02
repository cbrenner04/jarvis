# 01 - Run patch review passes before PR readiness

## Problem

Patch mode goes straight from completion to readiness. It needs a review loop first.

## Decisions

Run patch review only after zero unchecked boxes and a clean worktree, not interleaved with implementation iterations.
Patch review does not consume `maxIterations`; do not exit `5` after the checklist-closing implementation pass before review runs.
Each review prompt includes the completed spec tree plus the branch PR/base diff, not a merge-base-only diff that can miss shipped changes.
Run configured passes through `N` unless a blocker, quota stop, or existing hard error stops the run; do not stop on the first no-op pass.
Non-empty review passes commit as `review <N>` and refresh the draft PR body; no-op passes do not commit.
On a review blocker, post a PR comment, commit that pass's changes, keep the PR draft, exit `7`, and do not write `## Blocker` into spec files.

## Task Checklist

- [ ] Add a patch review prompt template at `prompts/patch/review.md` that mirrors plan review's subtractive bias, forbids spec-checklist edits, and scopes review work to the completed spec.
- [ ] Add prompt assembly and diff snapshot plumbing for patch review so each pass receives the current spec tree and the branch diff against the PR/base comparison range.
- [ ] Insert a deterministic review phase into `jarvis1 run` after completion detection and clean-tree validation but before the ready gate, and run exactly the configured number of passes unless an allowed stop condition fires.
- [ ] Reuse existing patch-mode agent classification and fallback semantics for review passes instead of inventing review-only outcome kinds or exit codes.
- [ ] Commit non-empty review passes with the standard `Jarvis-Agent:` trailer and PR-body refresh, and leave no-op passes uncommitted.
- [ ] Add blocker handling for patch review that posts a PR comment, commits the pass work, leaves the PR draft, and exits `7` without writing `## Blocker` into any spec file.
- [ ] Keep the existing ready gate ordering intact so `bun run ready` still runs only after the last review pass and still owns any `check:fix` follow-up commit.
- [ ] Add or update tests for ordered execution, no-op passes, blocker exits, review-pass commit shape, and the separation from `maxIterations`.

## Documentation updates

- [ ] Update `v1/docs/run-loop.md` with a patch-review phase description, the `git: false` skip behavior, and the blocker/ready ordering.
- [ ] Update `v1/docs/workflows.md` so the patch-mode diagram shows completion → review loop → ready gate, rather than completion → ready gate directly.
- [ ] Update inline docs near patch prompt assembly, completion, or PR-ready helpers where the new phase changes their contract.

## Acceptance criteria

- [ ] In normal `git: true` patch runs, `jarvis1 run` performs the configured review passes after the checklist is complete and the worktree is clean, then runs the ready gate only after those passes finish.
- [ ] Review passes use the completed spec tree and the branch PR/base diff as prompt inputs, and the agent is not asked to edit the spec checklist itself.
- [ ] A review pass that edits files creates one harness commit on the patch branch with subject `review <N>` and refreshes the draft PR body; a pass with no file changes creates no commit.
- [ ] Patch review continues through pass `N` even if an earlier pass is a no-op.
- [ ] A blocker raised during patch review posts a PR comment, commits that pass's changes, leaves the PR draft, exits with the existing blocker code `7`, and does not write `## Blocker` into any spec file.
- [ ] Review passes still run after the checklist-closing implementation iteration even when `maxIterations` would otherwise be exhausted by that point.
