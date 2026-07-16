---
name: a-non-durable-review-step-rolls-up-as-killed
---

# Every reviewed plan workflow reports `killed`, because the rollup reads a by-design missing run row as a kill

`jarvis run workflow plan --review-passes 1 --review-behavior light` reports
`{"runStatus":"killed"}` on success. Nothing was killed. The plan workflow's review step is
**deliberately** non-durable, and the status rollup interprets its absent run row as a kill.

## Problem

Observed 2026-07-16, 3 of 3 reviewed plan runs (`cleanup-retires-merged-v2-workspaces`,
`promotion-consumes-its-input`, `triage-merges-v2-plan-worktrees`). Each run's own log ends:

```json
{"kind":"boundary_committed","outcomeKind":"done","runStatus":"completed"}
{"kind":"loop_finished","loopOutcomeKind":"complete","iterationsConsumed":1,"resumable":false}
```

…and each durable row still reads `killed`. The two halves of the contradiction:

`v2/src/execution/workflow-runner.ts:1980` — the review step creates a run row **only** for
`intent-stage` landings. Its own comment states the intent:

```ts
// Only reviewed-intent workflows carry a durable post-review checkpoint; generic review
// steps stay non-durable (no run row, fresh synthesized run ID each dispatch).
const runId = landing?.kind === "intent-stage" ? store.createRun({...}) : crypto.randomUUID();
```

`v2/src/daemon/workflow-run-status-rollup.ts:39` — a step with no run row is a kill:

```ts
const stepRun = runById.get(step.stepId);
if (stepRun !== undefined) { if (stepRun.status !== "completed") return stepRun.status; }
else { return "killed"; }
```

A `plan` workflow's landing is `plan-stage`, not `intent-stage`. So its review step never creates a
row, and the rollup returns `killed` **by construction, on every reviewed plan run, forever**. The
rollup already skips `review-debate` steps for what looks like this exact reason; the non-durable
generic review step was never given the same treatment.

The cost is not cosmetic. `killed` is a terminal failure status: it sends the operator into
`v2/docs/operator-runbook.md` § Orphaned non-terminal runs looking for lost agent work and a
daemon restart that never happened, and it makes the one signal that should distinguish a healthy
plan from a dead one useless. This session lost time to exactly that before reading the rollup.

## Decisions

- **"No run row" and "killed" are different facts.** A step the runner intentionally never
  persists is not a terminal outcome and must not be reported as one. Rules out today's
  `else { return "killed" }` catch-all.
- The rollup distinguishes *step never durably recorded* (skip it, as `review-debate` is already
  skipped) from *step row exists and is non-terminal*. Rules out making every review step durable
  purely to satisfy the rollup — that inverts the runner's deliberate design to fix a reporting
  bug.
- The rollup's step skip-list is derived from whether the step is durable, not enumerated by
  behavior name. Rules out a second hardcoded `if (step.behavior === …) continue` that drifts the
  moment a third non-durable behavior lands — which is how this one was born.

## Prerequisites

- None.

## Out of scope

- Whether the generic review step *should* be durable — a real question, argued in
  `review-step-emits-log-events`; this seed only stops the rollup from lying about it.
- The staged-spec landing gap, if it proves separable (`plan-review-strands-the-spec-in-staging`).

## Documentation updates

- `v2/docs/operator-runbook.md` § Known gotchas — remove any guidance reading `killed` on a plan
  run as lost work once the rollup is honest.
- `v2/docs/workflow-runner.md` — which steps are durable, and how step status rolls up to run
  status.
