---
name: reviewed-plan-workflows-never-land-their-spec
---

# A reviewed plan workflow stages its spec and never lands it, because landing resumption is hardcoded to intent

`jarvis run workflow plan --review-passes 1 --review-behavior light` produces a PR containing
`.jarvis-plan-stage/` and no spec. The same intent through plain `jarvis run workflow plan` lands
correctly. Review defers the landing; only the `intent-stage` case is ever resumed, so a plan's
staged tree is dropped on the floor.

## Problem

Observed 2026-07-16, 3 of 3 reviewed plan runs (`cleanup-retires-merged-v2-workspaces` #1667,
`promotion-consumes-its-input` #1668, `triage-merges-v2-plan-worktrees` #1666). Every PR carried
only staged files:

```
.jarvis-plan-stage/00-retire-merged-v2-workspaces.md
.jarvis-plan-stage/01-expose-merged-workspace-cleanup.md
.jarvis-plan-stage/index.md
.jarvis-plan-stage/intent.md
```

The controlled comparison is unambiguous — same ready-intent, same agent, review flags the only
difference:

| path | result | spec dir | stage |
|---|---|---|---|
| `plan --review-passes 1 --review-behavior light` | `runStatus: killed` | none | still populated |
| `plan` | `runStatus: completed` | `v2/spec/20260716T214601Z-cleanup-retires-merged-v2-workspaces/` | consumed |

Checked 25 minutes after the reviewed run exited — well past the publication tail — the stage was
still on disk and no spec dir existed. This is not a mid-tail read.

**The landing layer is already generic.** `publication-landing.ts:5` defines
`intent-stage | plan-tree | none`, and `landPublication` dispatches all three; `landPlanTree` is
exactly what plain `plan` lands through. Only the *review step's resumption hook* is intent-shaped:

- `landReviewedIntentOutput` (`workflow-runner.ts:1575`) takes
  `Extract<PublicationLanding, { kind: "intent-stage" }>`
- `finishReviewedIntentLanding` (`:1606`) — same constraint
- both call sites guard `if (landing?.kind === "intent-stage")` (`:1834`, `:1986`)

So a `plan-tree` landing deferred by review has no resumption path. There is no design reason for
the asymmetry — review is review, and the thing being landed is already polymorphic. It is an
accident of `intent-reviewed` shipping first and never being generalized.

Cost: the reviewed plan path is unusable, which removes review from every plan in the repo. The
operator workaround is to drop the review flags, which is a silent quality regression, not a fix.

## Decisions

- **Landing resumption is polymorphic over `PublicationLanding`, like landing itself.** The review
  step resumes whatever landing it deferred by calling the existing generic `landPublication`.
  Rules out adding a parallel `finishReviewedPlanLanding` — a second hook that would drift from the
  first exactly as this one drifted from `landPublication`.
- The verdict-file handling in `landReviewedIntentOutput` (exclude verdict from staging, restore it
  on failure) is landing-kind-independent and applies to every reviewed landing. Rules out
  duplicating that logic per kind.
- Regression coverage asserts a reviewed **plan** run lands its spec tree and consumes its stage —
  the assertion that would have caught this. Rules out testing only the intent path, which is how
  the gap survived.

## Prerequisites

- None.

## Out of scope

- The false `killed` rollup on the same runs (`a-non-durable-review-step-rolls-up-as-killed`) —
  separate defect, same trigger.
- Whether the generic review step should be durable (`review-step-emits-log-events`).

## Documentation updates

- `v2/docs/workflow-runner.md` — landing kinds and which step lands them.
- `v2/docs/operator-runbook.md` — drop any "use plain `plan`" workaround once reviewed plan lands.
