---
name: pipeline-resume-clears-blocked-lane-dirty-worktree
---

# Pipeline resume/recover refuses on a dirty worktree with no reset override (auto-clear the blocked-lane case; add flag parity for the rest)

## Problem

Re-kicking a blocked fan-out plan lane with `jarvis pipeline resume <id> <branch-key>` refuses before dispatch with the dirty-reuse gate — the lane's plan worktree has uncommitted tracked/untracked paths (the agent's partial draft and/or an operator/agent `## Blocker` section left in the staged tree), which is the *normal* state of a blocked plan lane. Unlike standalone `implement`/`plan` re-runs, pipeline `resume`/`recover` expose **no `--reset-despite-dirty` (or `--reset-despite-landed-criteria`) override at all**, so the operator must manually `jarvis cleanup --yes --abandon <lane-branch>` each blocked lane before resume will rematerialize and redraft. Pipeline intent-stage re-dispatch already auto-clears a poisoned intent worktree when the gates pass; plan-stage resume does not, despite a redraft discarding that dirty tree anyway.

Two distinct gaps, both wanted: (1) the common blocked-plan-lane case should not need any operator action at all (auto-clear); (2) the general case needs the same explicit reset overrides the standalone workflow already has, for when the operator wants to force a dirty pipeline worktree (any stage) to reset rather than hand-abandon it. The standalone flags live on `implement`/`plan` re-run preflight; pipeline `resume`/`recover` should accept the same flags and thread them into the same `resetStaleWorkspace` gate.

Recurs on every blocked fan-out lane, which is common because fan-out lanes run on independent bases and a lane whose prerequisite is another lane's interface blocks by design ([[pipeline-fan-out-lanes-serial-chained-bases]]). So the redraft-recovery path is exactly where dirty worktrees are expected, and it is exactly the path that refuses.

## Evidence

- 2026-08-30, operator: `chess-mvp-yolo` `fast` pipeline — two plan lanes blocked on unmet sibling prerequisites. After merging the prerequisite half, `pipeline resume <id> <branch-key>` on both blocked lanes "failed before start with dirty branches" (the dirty-reuse gate). Recovery required a manual `cleanup --abandon` per lane, then resume.
- 2026-08-31, operator: recurred ("that bit me again"). Confirms this is not a one-off; the manual `cleanup --abandon` detour is a standing tax on pipeline recovery, and the missing flag parity is the lever the operator reaches for.

## Decisions

- A redraft-resume of a *failed/blocked* plan stage treats its own worktree as disposable: auto-clear (reset from base, same path as pipeline intent-stage re-dispatch) before the plan write step, since the redraft discards it regardless. Rules out requiring a manual `cleanup --abandon` for the ordinary blocked-lane case.
- Preserve the guard for states that are *not* safe to discard: a live run holding the worktree, or an operator-authored `## Blocker` the operator may still be editing — those keep refusing (parity with `recover`'s `operator_blocker` refusal), naming the blocking state.
- Expose the standalone reset overrides on pipeline `resume` and `recover`: `--reset-despite-dirty` (skip only the dirty gate) and `--reset-despite-landed-criteria` (skip only the landed-criteria gate), threaded into the same `resetStaleWorkspace` preflight the standalone workflow uses, for any stage — so a dirty pipeline worktree can be force-reset without a hand `cleanup --abandon`. Auto-clear covers the common blocked-plan-lane case; the flags cover the rest (implement stages, criteria drift, cases where auto-clear is deliberately conservative). Rules out pipeline recovery being the one path with no reset lever.
- Scope: `pipeline resume`/`recover` (whole-pipeline and branch-scoped forms). Auto-clear applies to `failed` plan stages; the explicit flags apply to any stage's dirty-reuse/landed-criteria refusal. Do not change standalone `plan`/`implement` re-run gates or the intent-stage path (already auto-clears).
- Out of scope: serial-chaining the lanes so they do not block in the first place ([[pipeline-fan-out-lanes-serial-chained-bases]]); the all-or-nothing terminal-merge behavior ([[pipeline-fan-out-per-lane-terminal-settlement]]).

## Acceptance criteria

- [ ] A daemon/pipeline test proves `pipeline resume <id> <branch-key>` on a `failed` plan lane whose worktree holds uncommitted draft paths auto-clears the worktree, rematerializes from base, and dispatches the plan write step — no manual `cleanup --abandon`; it fails against the pre-fix dirty-reuse refusal.
- [ ] A CLI+daemon test proves `pipeline resume`/`recover` accept `--reset-despite-dirty` and `--reset-despite-landed-criteria` and thread each into the same `resetStaleWorkspace` gate as standalone `implement`/`plan`, resetting a dirty stage worktree that would otherwise refuse; each flag skips only its own gate.
- [ ] A test proves resume still refuses (naming the state) when a live run holds the lane worktree, or when an operator `## Blocker` section remains in the staged tree, even with the flags — parity with `recover`'s `operator_blocker` and the descendant-check refusals that no override clears.
- [ ] A test proves the standalone `plan`/`implement` re-run dirty gate and the intent-stage path are unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Pipeline resume/recover: a blocked plan lane's dirty worktree is auto-cleared on redraft-resume; `--reset-despite-dirty`/`--reset-despite-landed-criteria` force a reset for any stage; the manual `cleanup --abandon` step is only for the preserved-refusal cases (live run, remaining `## Blocker`, descendant-check).

## Sequencing

P1 (raised) — operator-blocking friction that has now recurred across sessions; every blocked fan-out lane pays a hand `cleanup --abandon` tax, and pipeline recovery is the only re-run path with no reset lever. Independent of the settlement/front-door restructures. The auto-clear half and the flag-parity half can land together or as two subspecs (auto-clear first — it removes the common case; flags second — general escape hatch).
