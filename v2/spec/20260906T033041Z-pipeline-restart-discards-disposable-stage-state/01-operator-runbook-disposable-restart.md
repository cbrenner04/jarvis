# Operator runbook disposable restart

## Problem

`v2/docs/operator-runbook.md` § Pipeline resume still tells operators to hand-tear-down never-landed lanes and resolve draft-tree operator `## Blocker` before `pipeline resume`, and it lists operator blockers, non-descendant `HEAD`, and landed-criteria drift as unconditional refusals even when the lane never landed.

## Decision ledger

- Operator runbook states that default failed-plan `pipeline resume` rematerializes never-landed lanes (no PR, no unpushed non-staging commits) past stale worktree and draft-tree operator-blocker state without flags; rules out manual branch cleanup as the default restart path.
- Runbook names path-scoped unlanded-commits refusal and salvage recovery as the guard when real unpushed work exists; rules out implying resume silently destroys implementation commits.
- Runbook distinguishes draft-tree operator `## Blocker` (discarded on disposable resume) from landed blockers (committed on base or live draft PR — still refuse); rules out treating every staged blocker as operator work requiring manual removal.
- Runbook retires per-lane manual-teardown guidance superseded by default resume; `jarvis cleanup --abandon` remains the salvage path for preserved refusals.

## Task checklist

- Revise `v2/docs/operator-runbook.md` § Pipeline resume: disposable never-landed restart contract, landed versus draft-tree operator-blocker boundary, unlanded-commits salvage refusal, and removal of superseded manual-teardown steps.
- Document that lanes with an open draft PR are outside disposable never-landed classification and keep the existing open-PR / manual stale-reset path.
- Document when `pipeline recover` remains correct versus default disposable resume (corrected tree to keep versus discard-and-rematerialize).
- Cross-link `v2/docs/pipeline-execution.md` § Operator recovery for admission detail.

## Acceptance criteria

- [ ] `v2/docs/operator-runbook.md` documents default failed-plan resume disposal for never-landed lanes, landed versus draft-tree operator `## Blocker` handling, unlanded-commits salvage refusal, open-draft-PR exclusion from disposable classification, when `pipeline recover` versus default disposable resume applies, and retires superseded per-lane manual-teardown guidance.

## Documentation updates

- `v2/docs/operator-runbook.md` — restart disposal contract for never-landed lanes; retire per-lane manual-teardown guidance superseded by default resume.
