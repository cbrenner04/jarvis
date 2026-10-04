# Failed plan resume harness preamble

## Primary implementation surface

`v2/src/daemon/pipeline-execution.ts` (failed-plan redraft admission through shared stale-reset preflight; harness-draft-dirt classification at the resume dirty gate).

## Problem

Resuming a failed fan-out plan lane still expects a manual preamble — clean the branch, merge main, remove reserved harness `## Blocker` sections — before `jarvis pipeline resume`. Stale reset already retires harness draft dirt when the dirty gate is skipped, but the skip is all-or-nothing: operator edits outside `.jarvis-plan-stage/` can be destroyed silently, and reserved harness blockers still read like operator work the operator must delete by hand.

## Decision ledger

- Failed-plan resume performs the full harness preamble itself — shared stale reset, base alignment, reserved harness-blocker clearing, dispatch — without a preceding manual branch cleanup, base merge, or staged-blocker edit; rules out operator hand-executing those steps before every resume.
- Automatic dirty-gate skip applies only when every uncommitted path is recognisable harness draft dirt under `.jarvis-plan-stage/`; rules out treating arbitrary worktree edits as disposable blocked-plan dirt.
- Reserved harness `Artifact contract check failed:` sections are cleared as part of resume preamble, not left for manual removal; rules out requiring operator edits for harness-only contract-miss blockers.
- Operator-authored `## Blocker` still refuses before destructive retirement; rules out convenience that eats real operator decisions.
- Uncommitted change outside the harness draft-dirt contract refuses without discarding it and names the blocking paths in the refusal; rules out silent discard of operator work outside auto-clear.
- Harness-draft-dirt classification lives at the failed-plan resume stale-reset boundary in `pipeline-execution.ts`; rules out duplicating a parallel dirty classifier in CLI or cleanup.
- Deferred to first consumer: exact filename allowlist beyond `.jarvis-plan-stage/` tree membership — pin when a caller needs it.

## Tasks

- Limit failed-plan `skipDirtyWorktreeGate` to worktrees whose dirty paths are entirely under `.jarvis-plan-stage/`; refuse other dirty paths before worktree retirement and preserve bytes on disk.
- Ensure reserved harness blocker sections in staged `.jarvis-plan-stage/intent.md` do not block resume preamble or require manual removal before dispatch.
- Keep operator-authored `## Blocker` refusal before stale reset; include blocking path detail for non-harness dirty refusals.
- Add branch-scoped and whole-pipeline regression coverage in `pipeline-execution.test.ts` for harness-only blocker dispatch, harness draft dirt dispatch without manual commit, and operator-dirt refusal with preserved worktree state.
- Update `pipeline-execution.md` preamble contract for reserved versus operator blockers and harness-draft-dirt versus operator-dirt boundaries.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` resumes a failed plan lane whose staged `intent.md` carries only the reserved `Artifact contract check failed:` section and proves dispatch without any manual edit; it fails against a path that refuses or requires operator removal first (reachable on main: `failed plan resume preserves harness-only blocker despite both reset overrides` dispatches today but operator folklore still treats reserved sections as manual-delete work).
- [x] `pipeline-execution.test.ts` resumes a failed plan lane over a dirty worktree containing only harness draft dirt under `.jarvis-plan-stage/` and proves dispatch without a manual commit; it fails against the pre-fix dirty-reuse refusal when only non-harness paths are dirty (reachable on main: `whole-pipeline failed plan resume retires dirty draft and rematerializes from base before writer dispatch` uses `README.md` dirt and would fail once harness-only classification lands).
- [x] `pipeline-execution.test.ts` proves failed-plan resume over a worktree with uncommitted changes outside harness draft dirt refuses without discarding them and names the blocking paths or preserved state in the refusal; it fails against a path that silently clears or omits operator edits (reachable on main: `whole-pipeline failed plan resume retires dirty draft and rematerializes from base before writer dispatch` retires `README.md` dirty today).
- [x] The operator-blocker guard stays green, unchanged: `pipeline-stage-recovery.test.ts` `operator blocker leaves the named fan-out branch failed`, `daemon-pipeline-recover.test.ts` `pipeline_recover preserves an operator blocker on the named fan-out branch`, and `workflow-runner-resume.test.ts` `retains operator blockers and removes only captured harness blockers during recovery`. (Operator correction 2026-09-04: this criterion originally named two tests, `failed plan resume preserves operator blocker despite both reset overrides` and `... mixed blockers ...`, that have never existed in this repo — `git log -S` finds neither title in any commit. The guard itself is genuinely covered by the three tests named above, verified on `main`.)
- [x] `v2/docs/pipeline-execution.md` documents resume-owned harness preamble, reserved versus operator blocker handling, harness-draft-dirt auto-clear versus operator-dirt refusal, and cross-links disposition reporting in subspec 02.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/pipeline-execution.md` — plan-lane resume preamble ownership; reserved harness versus operator `## Blocker`; harness-draft-dirt auto-clear versus operator-dirt refusal before retirement.
