# 01 - Run patch review passes before PR readiness

## Problem

Patch mode goes straight from completion to readiness.

## Decisions

Review runs only after zero unchecked boxes and a clean worktree, never interleaved.
Gates bracket the passes: `bun run ready` → passes → `bun run ready` → `gh pr ready`. No per-pass validation.
Baseline gate = `maybeMarkReady` minus `gh pr ready`: runs ready, commits/pushes `check:fix`, leaves PR draft + clean worktree. (`maybeMarkReady` readies too early; bare `bun run ready` leaves `check:fix` dirty.)
Spec tree is read-only during review — no edits to checklist, prose, docs, or acceptance text. Harness enforces it (plan's write-boundary check, inverted); offending passes are reverted.
Review does not consume `maxIterations` — do not exit `5` before it runs.
Each prompt gets the spec tree + branch PR/base diff (merge-base-only can miss shipped changes).
Run all `N` passes unless a blocker, quota stop, or hard error halts; never stop on the first no-op.
Non-empty passes commit `review <N>` and refresh the PR footer (no description regen); no-ops don't commit.
Blocker: post a PR comment (new `gh pr comment` helper), commit the pass, keep draft, exit `7`, write no `## Blocker`. (PR exists by now; failed post is a generic error; no dedup.)
Quota exhaustion mid-review: exit `2`, leave draft — no fall-through, no auto-ready.

## Task Checklist

- [ ] `prompts/patch/review.md`: subtractive bias like plan review, forbids spec-tree edits, scoped to the completed spec.
- [ ] Prompt + diff-snapshot plumbing feeding each pass the spec tree and branch PR/base diff.
- [ ] Baseline-gate helper (`maybeMarkReady` minus `gh pr ready`).
- [ ] Wire the phase into `jarvis1 run` after completion + clean-tree checks: baseline → `N` passes → `maybeMarkReady`.
- [ ] Enforce the spec-tree read-only boundary (revert passes that touch a spec file).
- [ ] Reuse patch-mode agent classification/fallback — no review-only kinds or codes; quota exits `2`, PR draft.
- [ ] Commit non-empty passes with the `Jarvis-Agent:` trailer + footer refresh; leave no-ops uncommitted.
- [ ] `gh pr comment` helper in `v1/src/gh.ts` + blocker handling: comment, commit, draft, exit `7`, no `## Blocker`.
- [ ] Share `bun run ready` + `check:fix` commit logic between the baseline helper and `maybeMarkReady`.
- [ ] Tests: gate order, baseline committing `check:fix` (draft + clean), read-only boundary, no-ops, blocker (`7`), quota (`2`), commit shape, `maxIterations` separation.

## Documentation updates

- [ ] Update inline docs near patch prompt assembly, completion, or PR-ready helpers the phase touches.

## Acceptance criteria

- [ ] `git: true` runs do `bun run ready` → passes → `bun run ready` → `gh pr ready` after completion + clean worktree.
- [ ] Passes get the spec tree + branch PR/base diff; the spec tree is read-only and edits are reverted.
- [ ] Baseline gate runs ready, commits/pushes `check:fix`, leaves PR draft + clean worktree before pass 1.
- [ ] An editing pass makes one `review <N>` commit + footer refresh; a no-op makes none.
- [ ] Review runs through pass `N` past an earlier no-op.
- [ ] A blocker posts a PR comment, commits the pass, leaves draft, exits `7`, writes no `## Blocker`.
- [ ] Passes still run after the checklist-closing iteration even when `maxIterations` is exhausted.
- [ ] All review agents quota-exhausted → exit `2`, PR draft.
