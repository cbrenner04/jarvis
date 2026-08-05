# Write-loop settlements

## Problem

**Dirty `no-work`.** A write step resolving `no-work` while the worktree holds uncommitted
tracked changes currently settles `runStatus: "completed"`. It must settle a named non-`completed`
failure listing those paths. The `publishCompletion === false` short-circuit can emit
`loopOutcomeKind: "complete"` without the dirty guard that already runs on the
`published.commitSha === undefined` publication path.

**Resumable `iteration_timeout`.** `iteration_timeout` always settles `resumable: false` /
`nextAction: "stop"`, so documented recovery re-dispatches and retires the workspace — destroying
subspecs whose non-human-only criteria were already satisfied. A timeout with at least one fully
satisfied subspec must retain branch, worktree, and iteration commits for `jarvis run resume`.

[00 - Preflight gates](./00-preflight-gates.md) is the primary defense against drifted worktree
reuse; write-loop settlement is the backstop when a run still reaches the `no-work` completion
boundary over a dirty tree.

## Decision ledger

- Write step resolving `no-work` over uncommitted tracked paths settles a named non-`completed` failure listing those paths — rules out reporting success over uncommitted work; reuses `shouldFailTerminalCompletionForDirtyWorktree` / `getUncommittedPaths` at the `no-work` completion boundary, including the `publishCompletion === false` path.
- `iteration_timeout` with at least one subspec's non-human-only criteria fully ticked settles `resumable: true` on durable `loop_finished`; a run with no completed subspec keeps `resumable: false` — rules out "re-dispatch and redo" as sole recovery. `nextAction` projection defers to [02 - Daemon list/wait projection](./02-daemon-list-wait-projection.md).
- Terminal `loop_finished` for **every** `iteration_timeout` carries `completedSubspecPaths` and `remainingSubspecPaths` (repo-relative subspec file paths) — rules out an opaque timeout inventory.
- Completed-subspec `iteration_timeout` recovery is `jarvis run resume` on the retained workspace — no `resetStaleWorkspace`, no rematerialization — rules out resume paths that discard iteration commits.
- A tree whose every subspec's non-human-only criteria are ticked keeps settling `implement.already_complete` at launch preflight — rules out `no-work`/`completed` on one fully ticked subspec (Problem B, landed #2613).

## Prerequisites

- [00 - Preflight gates](./00-preflight-gates.md) merged — stale-dirty reuse is refused before the write step can read a drifted worktree copy.
- Per-iteration commit checkpointing on every settled main-loop iteration.
- Implement routes to the first subspec with unticked non-human-only acceptance criteria; a fully ticked tree settles `implement.already_complete`.
- Write-loop completion boundary maps agent `no-work` to `runStatus: "completed"` when no dirty-worktree guard fires (baseline the regression falsifies).

## Task checklist

- Guard the `no-work` → `completed` boundary with the dirty-worktree predicate on both publication and `publishCompletion === false` paths; settle non-`completed` with paths named in durable output.
- Teach `finishIterationTimeout` to classify completed subspecs (shared unticked-criteria predicate), set `resumable` accordingly, and emit `completedSubspecPaths` / `remainingSubspecPaths` on every `iteration_timeout` `loop_finished`.
- Add resume integration proving retained branch, worktree, no `resetStaleWorkspace`, and pre-timeout iteration commits still reachable from branch head after resume settles.
- Update operator runbook Gate trust / Recovery and `v1-behaviors.md`.

## Acceptance criteria

- [x] `write-loop.test.ts` `no-work over dirty worktree with publishCompletion false settles non-completed failure naming uncommitted paths` drives a write step resolving `no-work` with `publishCompletion: false` over uncommitted tracked paths, asserts `runStatus` other than `completed`, names those paths in durable loop output, and does not append `loop_finished` with `loopOutcomeKind: "complete"`; fails against current boundary (dirty guard skipped on the `publishCompletion === false` short-circuit).
- [x] `write-loop.test.ts` `iteration_timeout with one completed subspec is resumable` and `iteration_timeout with no completed subspec stays non-resumable` drive implement-linked fixtures (one complete + one incomplete subspec, and all-incomplete respectively); terminal `loop_finished` carries `resumable: true` vs `resumable: false`; inverting the completed-subspec predicate turns the resumable case red.
- [x] `write-loop.test.ts` `iteration_timeout with one completed subspec is resumable` pins `completedSubspecPaths` and `remainingSubspecPaths` on terminal `loop_finished` against the two-subspec fixture; `iteration_timeout with no completed subspec stays non-resumable` pins both lists empty vs full-remaining for the all-incomplete fixture.
- [x] `daemon-resume.test.ts` `resume after iteration_timeout retains worktree commits without stale reset` resumes a run that timed out with one completed subspec, asserts no `resetStaleWorkspace` / rematerialization on resume, and pre-timeout iteration commit SHAs remain ancestors of branch head after resume settles; fails against current timeout settlement.
- [x] `write-loop.test.ts` `no-work over dirty worktree with publishCompletion false settles non-completed failure naming uncommitted paths` links `// @mutate v2/src/execution/write-loop.ts "shouldFailTerminalCompletionForDirtyWorktree(uncommittedPaths)" -> "false"` in the `publishCompletion === false` completion branch; inverting turns the test red.
- [x] `write-loop.test.ts` `iteration_timeout with one completed subspec is resumable` links `// @mutate v2/src/execution/write-loop.ts "hasCompletedSubspec(completionInventory)" -> "false"`; inverting turns the test red.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `completed` implement row no longer admits the `no-work`-over-dirty case; document what `no-work` now settles; `iteration_timeout` is conditionally resumable with completion inventory on the terminal row.
- `v2/docs/operator-runbook.md` § Recovery — replace "re-dispatch the workflow" guidance for completed-subspec `iteration_timeout` with resume-from-retained-workspace guidance.
- `v2/docs/v1-behaviors.md` — record dirty `no-work` refusal, resumable `iteration_timeout`, completion inventory fields, and resume retention contract.
