---
name: fan-out-plan-resolution-is-all-or-nothing-across-lanes
---

# A consumed sibling ready-intent permanently blocks every later fan-out lane's plan dispatch

## Problem

Approving a fan-out lane's `approve-intent` gate re-resolves **every** sibling lane's ready-intent, not just the approved lane's. A sibling that already planned successfully has had its ready-intent `git mv`'d into that spec's `intent.md`, so the path no longer resolves — and resolution is all-or-nothing, so the approved lane's plan stage fails on a file that belongs to a different, already-finished lane.

Consequence: **a fan-out pipeline can never advance a second lane after the first lane's plan lands.** Every multi-lane pipeline this project has run needed its dependent lanes hand-driven; this is why.

`resolveChainedReadyIntentPaths` (`v2/src/daemon/pipeline-stage-resolve.ts:344`) loops the whole `downstreamInputs` list and returns the first verification failure for the entire fan-out:

```ts
for (const path of downstreamInputs) {
  const verified = await verifyChainedReadyIntentPath(prior, context, path);
  if (!verified.ok) return verified;
}
return { ok: true, kind: "fan-out", paths: downstreamInputs };
```

`resolveForDownstreamPaths` (`:368`) then re-verifies each path a second time inside its dispatch loop, with the same `return verified` on first failure. Neither loop knows which lane is being approved: `resolvePlanStage` (`:507`) is single-path and never reads a `branchKey`; `PipelineStageResolveDeps.branchKey` (`:71`) is used only for prior-stage artifact lookup, never for input selection. Lane↔input binding happens later and purely positionally, at `opts.results[branchIndex]` (`v2/src/daemon/pipeline-execution.ts:1988`).

## Evidence (2026-09-06, two independent pipelines, symmetric)

Both pipelines had their head lane approved, planned, and implemented in a prior session; each was left holding one dependent lane at `approve-intent`. Approving that gate failed the plan stage in under 25 seconds, with **no run row and no agent invocation**:

| Pipeline | Approved lane | Plan stage `failureDetail.message` |
| --- | --- | --- |
| `d2029fbd` | `daemon-linked-run-row-resume-admission` | `pipeline-stage-resolve: downstream input v2/spec/ready-intents/write-sibling-step-id-matcher.md never landed on the prior stage branch or pipeline admission base; re-drive the prior stage standalone with jarvis run workflow` |
| `14108361` | `pipeline-restart-discards-disposable-stage-state` | `pipeline-stage-resolve: downstream input v2/spec/ready-intents/stale-reset-disposable-lane-retirement-gates.md never landed …` |

In both cases the named file is the **head lane's** ready-intent, consumed when that lane planned (specs `20260905T234404Z-write-sibling-step-id-matcher` and `20260905T234408Z-stale-reset-disposable-lane-retirement-gates`, landed #3514/#3512). The approved lane's own ready-intent was present and untouched on `main` the whole time.

The failure then cascaded into [[skipped-successor-strands-a-recovered-lane]]: both lanes' `approve-plan` rows flipped to `skipped`, so no verb reopens them. Both P0 lanes had to be driven standalone.

The error text is also misdirecting — "re-drive the prior stage standalone" points at the intent stage, which succeeded and is not the problem.

## Decisions

- Plan-stage resolution for an approved fan-out lane verifies and resolves **only that lane's** downstream input, selected by `branchKey`, not the whole `downstreamInputs` list; rules out one lane's state failing a sibling's dispatch.
- Lane↔input binding is by `branchKey` equality (`branchKeyFromDownstreamInput(path) === branchKey`), not by array index; a lane whose input cannot be matched refuses with a message naming the lane and the unmatched input, rather than silently degrading. Rules out the unguarded positional join at `pipeline-execution.ts:1988`, where a short or reordered `results` array binds a lane to a sibling's ready-intent with no error.
- A downstream input that resolves to an already-landed spec tree (the sibling-consumed shape) is recognized as *satisfied*, not *missing*, wherever the whole list is still legitimately walked; rules out a successful lane's own completion reading as a failure.
- Refusal text names the lane whose input failed and does not recommend re-driving the intent stage when that stage succeeded; rules out the current misdirecting message.

## Acceptance criteria

- [ ] A pipeline-execution test drives `approve` on the second lane of a two-lane fan-out whose first lane already planned (its ready-intent consumed into the spec tree) and asserts the second lane's plan stage dispatches; it fails against the current whole-list verification with the sibling's path in the error.
- [ ] A test asserts plan-stage resolution for an approved lane verifies only that lane's downstream input — a sibling input made unresolvable does not affect the approved lane's dispatch.
- [ ] A test asserts a lane is bound to the downstream input whose derived branch key equals the lane's `branchKey`, and that a mismatched or short `results` set refuses naming the lane and input rather than binding positionally.
- [ ] A test asserts the refusal message names the failing lane and omits the "re-drive the prior stage standalone" recommendation when the prior stage succeeded.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — per-lane downstream-input resolution and `branchKey` binding.
- `v2/docs/operator-runbook.md` — retire the "approve one gate at a time and hand-drive the rest" workaround for this shape.
- `v2/docs/v1-behaviors.md` — record per-lane fan-out plan resolution.
