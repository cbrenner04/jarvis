# Execution loop

## Problem

**Dirty `no-work`.** A write step resolving `no-work` while the worktree holds uncommitted
tracked changes currently settles `runStatus: "completed"`. It must settle a named non-`completed`
failure listing those paths.

**Resumable `iteration_timeout`.** `iteration_timeout` always settles `resumable: false` /
`nextAction: "stop"`, so documented recovery re-dispatches and retires the workspace — destroying
subspecs whose non-human-only criteria were already satisfied. A timeout with at least one fully
satisfied subspec must retain branch, worktree, and iteration commits for `jarvis run resume`.

## Decision ledger

- Write step resolving `no-work` over uncommitted tracked paths settles a named non-`completed` failure listing those paths — rules out reporting success over uncommitted work; reuses the existing dirty-worktree predicate seam (`shouldFailTerminalCompletionForDirtyWorktree` / `getUncommittedPaths`) at the `no-work` completion boundary, not only the publication tail.
- `iteration_timeout` with at least one subspec's non-human-only criteria fully ticked settles `resumable: true` / terminal `loop_finished.nextAction` equivalent via `resumable: true`; a run with no completed subspec keeps `resumable: false` — rules out "re-dispatch and redo" as sole recovery for partial progress.
- Terminal `loop_finished` for `iteration_timeout` carries `completedSubspecPaths` and `remainingSubspecPaths` (repo-relative subspec file paths) — rules out an opaque timeout inventory.
- Completed-subspec `iteration_timeout` recovery is `jarvis run resume` on the retained workspace — no `resetStaleWorkspace`, no rematerialization — rules out resume paths that discard iteration commits.
- A tree whose every subspec's non-human-only criteria are ticked keeps settling `implement.already_complete` at launch preflight — rules out `no-work`/`completed` on one fully ticked subspec (Problem B, landed #2613).

## Prerequisites

- [00 - Preflight gates](./00-preflight-gates.md) merged — stale-dirty reuse is refused before the write step can read a drifted worktree copy.
- Per-iteration commit checkpointing on every settled main-loop iteration.
- Implement routes to the first subspec with unticked non-human-only acceptance criteria; a fully ticked tree settles `implement.already_complete`.
- Write-loop completion boundary maps agent `no-work` to `runStatus: "completed"` when no dirty-worktree guard fires (baseline the regression falsifies).

## Task checklist

- Guard the `no-work` → `completed` boundary with the dirty-worktree predicate; settle non-`completed` with paths named in durable output.
- Teach `finishIterationTimeout` to classify completed subspecs (shared unticked-criteria predicate), set `resumable` accordingly, and emit `completedSubspecPaths` / `remainingSubspecPaths` on `loop_finished`.
- Add resume integration proving retained branch, worktree, no `resetStaleWorkspace`, and pre-timeout iteration commits still reachable from branch head after resume settles.
- Update operator runbook Gate trust / Recovery and `v1-behaviors.md`.

## Acceptance criteria

- [ ] `write-loop.test.ts` `no-work over dirty worktree settles non-completed failure naming uncommitted paths` asserts a write step resolving `no-work` with uncommitted tracked paths settles `runStatus` other than `completed`, names those paths in durable loop output, and does not append `loop_finished` with `loopOutcomeKind: "complete"`; fails against current boundary.
- [ ] `write-loop.test.ts` `iteration_timeout with one completed subspec is resumable` and `iteration_timeout with no completed subspec stays non-resumable` drive implement-linked fixtures (one complete + one incomplete subspec, and all-incomplete respectively); terminal `loop_finished` carries `resumable: true` vs `resumable: false`; inverting the completed-subspec predicate turns the resumable case red.
- [ ] `write-loop.test.ts` `iteration_timeout with one completed subspec is resumable` pins `completedSubspecPaths` and `remainingSubspecPaths` on terminal `loop_finished` against the two-subspec fixture.
- [ ] `write-loop.test.ts` `no-work over dirty worktree settles non-completed failure naming uncommitted paths` links `// @mutate` inverting the dirty-`no-work` guard in `write-loop.ts`; inverting turns the test red.
- [ ] `write-loop.test.ts` `iteration_timeout with one completed subspec is resumable` links `// @mutate` inverting the completed-subspec resumability predicate in `write-loop.ts`; inverting turns the test red.

## Documentation updates
