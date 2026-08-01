---
name: pipeline-approval-releases-the-wrong-branch
---

# A pipeline approval dispatches sibling branches whose own gate is still awaiting

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

## Decisions

- Stage dispatch after an approval selects successors **only on the approved decision's own
  `branchKey`** — rules out "release every branch's next stage", which is the observed behavior.
- A branch whose gate is `awaiting` is never dispatched — rules out treating an approval as a
  pipeline-wide token.
- Fix the dispatch selection, not the `pipeline list` projection: the refusal path already keys on
  `branchKey` correctly, so the projection is reporting true state — rules out "the display is
  wrong" as the diagnosis.
- Out of scope: single-default-branch pipelines (`branchKey: "default"`), where the bug cannot be
  observed because there is only one successor.

## Acceptance criteria

- [ ] Approving one branch of a two-branch fan-out at `approve-intent` dispatches that branch's
      `plan` stage and leaves the unapproved branch's `plan` `pending`; a test fails against the
      current dispatch, which starts the unapproved branch.
- [ ] While a sibling gate is `awaiting`, no stage on that sibling's `branchKey` reaches
      `running`; a regression asserts it across the full stage list.
- [ ] Approving both branches dispatches both successors, each on its own `branchKey`.
- [ ] A fan-out pipeline with exactly one failed branch stage is admitted by `pipeline resume`;
      `multiple_failed_stages` is reserved for genuinely independent failures. A regression covers
      the one-failed-branch case, which today refuses.
- [ ] Source-mutating the successor selection back to first-pending-wins turns the single-approval
      test RED, with a comment checkpoint naming the mutation. Do **not** add a production test
      flag.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline approve and reject — state that an approval admits only
  its own `branchKey`'s successor, once that is true.

## Prerequisites

- The daemon's pipeline stage-advance path and its `branchKey` successor selection
- `pipeline_approve` decision persistence (already branch-scoped: duplicate approve refuses
  `status_not_awaiting`)
