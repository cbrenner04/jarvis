---
name: pipeline-approval-releases-the-wrong-branch
---

# A pipeline approval dispatches sibling branches whose own gate is still awaiting

Splitting does not apply: every acceptance criterion lands on the daemon pipeline continuation path (`continuePipeline` / `runPipeline` / approval continuation); CLI approve wiring is branch-scoped.

## Problem

On an intent fan-out, `jarvis pipeline approve <id> approve-intent <branchKey>` marks the named
branch's gate `approved` and then dispatches **every** branch's next stage, including siblings
whose own gate still reads `awaiting`. A held gate does not hold.

Observed 2026-08-01 on pipeline `8cf893f4-e429-4179-a7aa-81191edcf9c1` (`full-review`, project
`jarvis`). The intent stage split one ready-intent into two branches. After a single approve of
`shared-prices-compute-list-price-cost`:

```text
intent          default                                succeeded
approve-intent  shared-invocation-cursor-computed-cost awaiting
approve-intent  shared-prices-compute-list-price-cost  approved
plan            shared-invocation-cursor-computed-cost running     <-- gate still awaiting
plan            shared-prices-compute-list-price-cost  pending     <-- gate approved
```

`jarvis run list` confirms it is not a display artifact — the live row was
`plan/shared-invocation-cursor-computed-cost`. The approved branch's `plan` did start later and
succeeded, so the defect is not "the wrong branch instead of the right one": it is that an
`awaiting` gate does not withhold its own branch at all.

**It costs the whole pipeline, not just the branch.** The prematurely-dispatched branch failed
(correctly — its prerequisite was unmerged). Its sibling was then approved through `approve-plan`
and its `implement` stage also failed, with no run row and nothing in the daemon log.
`jarvis pipeline resume` then refused `multiple_failed_stages`, so the run could not be recovered
at all and the remaining work had to be finished through `jarvis run workflow implement`. One
premature dispatch turned a two-branch fan-out into an unresumable pipeline.

The two branches had a real dependency (the prices module must land before the cursor cost
consumer). Holding the dependent gate is the operator's only lever for ordering a fan-out, and it
does not hold. A second `approve` of the same branch correctly refuses `status_not_awaiting`, so
the refusal path is branch-scoped while the dispatch path is not.

`pipeline-execution.test.ts` (`pipeline approve and reject stay isolated per branchKey`) pins a
shared post-fan-out gate, not per-branch approval gates on `full-review`: after approve,
`applyPipelineApprovalDecision` calls `continuePipeline` with no `branchKey`, and `runPipeline`
walks every `activeSplit.branchKeys`.

## Decisions

- Stage dispatch after an approval selects successors **only on the approved decision's own `branchKey`** — rules out "release every branch's next stage", which is the observed behavior.
- A branch whose gate is `awaiting` is never dispatched — rules out treating an approval as a pipeline-wide token.
- Post-approve continuation must pass the approved `branchKey` into successor selection; sibling isolation in the existing test does not cover per-branch `approve-intent` gates — rules out assuming refusal-path scoping already pins dispatch.
- Fix the dispatch selection, not the `pipeline list` projection: the refusal path already keys on `branchKey` correctly, so the projection is reporting true state — rules out "the display is wrong" as the diagnosis.
- Out of scope: single-default-branch pipelines (`branchKey: "default"`), where the bug cannot be observed because there is only one successor. Resume reopen for a single failed branch row is already covered elsewhere; fixing dispatch prevents the observed cascade into `multiple_failed_stages`.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `approve-intent continuation dispatches only the approved branchKey` fails against the current dispatch (starts the unapproved branch's `plan`) and passes after the fix: one `approve-intent` approve dispatches that branch's `plan` and leaves the sibling's `plan` `pending` with no sibling stage `running` while its gate is `awaiting`.
- [ ] `pipeline-execution.test.ts` — `approving both fan-out branches dispatches each successor on its own branchKey` fails against the current dispatch and passes after the fix.
- [ ] Source-mutating the successor selection back to first-pending-wins turns `approve-intent continuation dispatches only the approved branchKey` RED, with a comment checkpoint naming the mutation. Do **not** add a production test flag.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline approve and reject — correct the false claim that approve does not affect sibling gates; state that an approval admits only its own `branchKey`'s successor.
- `v2/docs/v1-behaviors.md` — record post-approve fan-out continuation scoped to the approved `branchKey`.

## Prerequisites

- Post-approve `continuePipeline` → `runPipeline` walks every `activeSplit.branchKeys` with no approved `branchKey` context (`applyPipelineApprovalDecision` does not pass `branchKey` into continuation) — the path this intent fixes.
- `pipeline_approve` persists branch-scoped decisions; duplicate approve on the same branch refuses `status_not_awaiting`.
