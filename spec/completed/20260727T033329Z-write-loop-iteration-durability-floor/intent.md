---
name: write-loop-iteration-durability-floor
---

# Write-loop iteration durability floor engages without `progress`

## Problem

`workflow-steps-commit-each-progress-iteration` committed each iteration only when
`result.kind === "progress"`. Implement-shaped runs finish in one iteration with `done`/`complete`,
so `commitProgressIteration` never ran and mid-iteration kill left an all-dirty worktree (observed
`idle_output_timeout` on run `9c61a90e`: nine modified files, zero commits).

## Decisions

- Durability must not depend on the agent returning `progress` — rules out treating the shipped path as sufficient when implement runs never emit `progress`.
- Commit on boundaries the harness controls (settled step and in-flight loss paths), not by fabricating `progress` outcomes — rules out lying about outcome kind to reach the existing hook.
- Terminal completion commit remains the publication input; in-flight commits are a durability floor only — rules out changing publish/PR semantics.
- Verification must use a killed or aborted mid-iteration run, not success-only — rules out tests that stay green while the `progress`-only hook is dead.
- `progress`-path commit ordering and fail-closed semantics stay as shipped — rules out regressing multi-iteration `progress` tests.

## Acceptance criteria

- [ ] A write step killed mid-iteration, after the agent has written files but before it returns, leaves those files committed on the branch; `write-loop.test.ts` test `mid-iteration kill commits agent edits before settle` drives that kill and asserts a non-empty `base..HEAD` commit list. Fails against current code.
- [ ] A single-iteration `done` run commits its work before the completion commit; `write-loop.test.ts` test `single-iteration done without progress emits iteration_commit` asserts an `iteration_commit` (or equivalent) record for a run that never returns `progress`. Fails against current code.
- [ ] `write-loop.test.ts` → `describe("per-iteration git commit on progress")` (including `terminal completion adds a third sha after two iteration commits and attribution lists all`, `iteration_commit event distinguishes committed, no_file_changes, and no_git skips`, and related cases in that block) stays green.
- [ ] Inverting the new commit trigger turns `mid-iteration kill commits agent edits before settle` RED.
- [ ] No test asserts durability using only a successfully-completed run.

## Documentation updates

- `v2/docs/write-behavior.md` — what is committed and when; state the durability floor precisely; reconcile `iteration_timeout` / terminal-outcome text with in-flight loss-path commits so timeout vs kill semantics stay consistent.
- `v2/docs/operator-runbook.md` § Orphaned non-terminal runs — correct text that implied single-iteration `publishCompletion: false` steps still commit in-flight via `progress` only.
- `v2/docs/v1-behaviors.md` — per-iteration commit cadence bullet (~L459): stop claiming commits require `progress` iterations; record the durability floor for git-backed write steps including `publishCompletion: false`.

## Prerequisites
