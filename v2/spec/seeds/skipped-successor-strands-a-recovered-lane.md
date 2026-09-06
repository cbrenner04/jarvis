---
name: skipped-successor-strands-a-recovered-lane
---

# A lane whose stage failed then succeeded keeps a `skipped` successor no verb can reopen

## Problem

When a fan-out branch's stage settles anything other than `succeeded`, `settleFanOutBranch` (`v2/src/daemon/pipeline-execution.ts:2090`) calls `skipRemainingStages(…, index + 1, targetBranchKey)`, writing `skipped` to every later stage in that branch. Correct at the time. But if that stage is later re-driven and succeeds, nothing resets the successor: the branch ends up `plan: succeeded` + `implement: skipped`, and **no pipeline verb can reach it**.

Branch-scoped resume admits only through a replayable `failed` row — `scanBranchSuffixForAdmission` returns `admissible` on `record.status === "failed"`, and otherwise falls through to `not_resumable`. With the plan `succeeded` and the implement `skipped`, there is no `failed` row, so `jarvis pipeline resume <id> <branch>` refuses `branch_not_resumable`. `pipeline recover` needs a failed **plan** stage and refuses too. `skipped` is in `TERMINAL_STAGE_STATUSES`, so nothing ages it out.

The un-skip logic exists but is unreachable: `reopenFailedPipeline` (`v2/src/persistence/state-store.ts:2031`) reopens the failed row and then flips each suffix row `WHERE status = 'skipped'` back to `pending`. It is anchored on a failed row that no longer exists.

**Evidence (operator's `chess-mvp-yolo-2`, pipeline `a00ca258`, branch `board-game-end-view-model`, 2026-09-06).** Three plan runs on that branch: `5b980ae5` blocked (`agent_blocked`), `8da9178c` failed (`invocation_error`), then `c1e3d8ac` completed with a real artifact (spec `20260905T224241Z-board-game-end-view-model`, PR #57). The first failure skipped the implement row. The plan now reads `succeeded`; the implement still reads `skipped` with no `workflowInvocationId`, and `jarvis pipeline resume a00ca258… board-game-end-view-model` returns `branch_not_resumable`. Sibling lanes are unaffected — `skipRemainingStages` filters on `branchKey`, so this is not cross-lane bleed. The lane's only exit is to abandon the pipeline, merge the plan PR by hand, and dispatch a standalone implement.

## Decisions

- Re-driving a stage to `succeeded` reopens that branch's `skipped` successors to `pending` in the same transaction that writes the success; rules out a stage advancing past a successor that stays terminally skipped.
- Branch resume admission treats a branch whose last satisfied stage has an unsatisfied `skipped` successor as admissible (reopen the successor, not a failed predecessor); rules out `branch_not_resumable` on a branch that plainly has undone work.
- `skipped` written by `skipRemainingStages` is recorded as *provisional* (caused by a predecessor failure) and distinguishable from a stage skipped because it was never applicable — for example the `default` rows a fan-out split retires; rules out un-skipping rows that were correctly retired.
- The refusal names the blocking row's stage id and status, not a bare reason string; rules out an operator having to read `pipeline list --json` to learn which row refused (the CLI prints only `reason` today).

## Acceptance criteria

- [ ] A pipeline test proves a fan-out branch whose stage failed, skipped its successor, and then succeeded on re-drive has that successor back at `pending` and dispatchable; it fails against the current `skipped` row.
- [ ] A test proves branch-scoped resume admits such a branch instead of refusing `branch_not_resumable`.
- [ ] A test proves `default` rows retired by a fan-out split are **not** reopened by the same path.
- [ ] A test proves the `branch_not_resumable` refusal names the blocking stage id and status.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — provisional vs terminal `skipped`, and successor reopen on re-drive.
- `v2/docs/operator-runbook.md` — retire the "abandon and dispatch standalone" workaround for this shape.
