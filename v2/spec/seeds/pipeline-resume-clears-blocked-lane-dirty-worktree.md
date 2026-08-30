---
name: pipeline-resume-clears-blocked-lane-dirty-worktree
---

# Pipeline resume/recover of a blocked plan lane refuses on its own expected dirty worktree

## Problem

Re-kicking a blocked fan-out plan lane with `jarvis pipeline resume <id> <branch-key>` refuses before dispatch with the dirty-reuse gate — the lane's plan worktree has uncommitted tracked/untracked paths (the agent's partial draft and/or an operator/agent `## Blocker` section left in the staged tree), which is the *normal* state of a blocked plan lane. Unlike standalone `implement`/`plan` re-runs, pipeline `resume` exposes no `--reset-despite-dirty` override, so the operator must manually `jarvis cleanup --yes --abandon <lane-branch>` each blocked lane before resume will rematerialize and redraft. Pipeline intent-stage re-dispatch already auto-clears a poisoned intent worktree when the gates pass; plan-stage resume does not, despite a redraft discarding that dirty tree anyway.

Recurs on every blocked fan-out lane, which is common because fan-out lanes run on independent bases and a lane whose prerequisite is another lane's interface blocks by design ([[pipeline-fan-out-lanes-serial-chained-bases]]). So the redraft-recovery path is exactly where dirty worktrees are expected, and it is exactly the path that refuses.

## Evidence (2026-08-30, operator)

`chess-mvp-yolo` `fast` pipeline: two plan lanes blocked on unmet sibling prerequisites. After merging the prerequisite half, `pipeline resume <id> <branch-key>` on both blocked lanes "failed before start with dirty branches" (the dirty-reuse gate). Recovery required a manual `cleanup --abandon` per lane, then resume.

## Decisions

- A redraft-resume of a *failed/blocked* plan stage treats its own worktree as disposable: auto-clear (reset from base, same path as pipeline intent-stage re-dispatch) before the plan write step, since the redraft discards it regardless. Rules out requiring a manual `cleanup --abandon` for the ordinary blocked-lane case.
- Preserve the guard for states that are *not* safe to discard: a live run holding the worktree, or an operator-authored `## Blocker` the operator may still be editing — those keep refusing (parity with `recover`'s `operator_blocker` refusal), naming the blocking state.
- Scope: `pipeline resume` of a `failed` plan stage (and the branch-scoped form); do not change standalone `plan`/`implement` re-run gates or the intent-stage path (already auto-clears).
- Out of scope: serial-chaining the lanes so they do not block in the first place ([[pipeline-fan-out-lanes-serial-chained-bases]]); the all-or-nothing terminal-merge behavior ([[pipeline-fan-out-per-lane-terminal-settlement]]).

## Acceptance criteria

- [ ] A daemon/pipeline test proves `pipeline resume <id> <branch-key>` on a `failed` plan lane whose worktree holds uncommitted draft paths auto-clears the worktree, rematerializes from base, and dispatches the plan write step — no manual `cleanup --abandon`; it fails against the pre-fix dirty-reuse refusal.
- [ ] A test proves resume still refuses (naming the state) when a live run holds the lane worktree, or when an operator `## Blocker` section remains in the staged tree.
- [ ] A test proves the standalone `plan`/`implement` re-run dirty gate and the intent-stage path are unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Pipeline resume: a blocked plan lane's dirty worktree is auto-cleared on redraft-resume; the manual `cleanup --abandon` step is only for the preserved-refusal cases (live run, remaining `## Blocker`).
