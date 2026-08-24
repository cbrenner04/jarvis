# 00 - Surface terminal intent-landing cause

## Problem

A terminal intent-split landing-contract failure discards the gate's violation text, leaving `run list`, `run wait`, pipeline `failureDetail`, and `run log` unable to name the violation class or offending paths.

## Decision ledger

- Carry a bounded free-text `message` beside the closed operator-error `reason` and `nextAction`; rules out adding one reason per landing violation class.
- Persist the cause on the terminal `loop_finished` record and compose the operator error from that record; rules out reconstructing evidence from a later worktree or Git inspection.
- Bound the complete landing violation with the shared log-text truncation contract; rules out an unbounded path list or a second limit.
- Make the terminal and operator-error `message` optional and populate it only for intent-split landing-contract settles that have gate evidence; rules out inventing causes for legacy or unrelated `landing_failed` origins.
- Preserve `landing_contract_reprompt` fields and timing for iterations that can reprompt; rules out replacing the existing diagnostic record with the terminal-only cause.

## Task checklist

- [ ] Attach the bounded gate violation to terminal `loop_finished` when an intent-split landing-contract miss settles `landing_failed`, including immediate non-repromptable violations and reprompt-budget exhaustion.
- [ ] Project that optional terminal cause through `composeRunOperatorError` as `RunOperatorError.message` while preserving `reason: "landing_failed"`, `retryable: true`, and `nextAction: "resume"`.
- [ ] Pin run-log, `run list` / `run wait`, and pipeline-stage `failureDetail` propagation, plus cause-less compatibility and truncation negatives, without adding production test inversion hooks.
- [ ] Update the durable docs listed below in the same change.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop-intent-landing.test.ts` — `rogue path outside stage settles landing_failed without reprompt and names its cause`; Keystone checkpoint: the regression drives a real rogue path, asserts the terminal log and composed operator error carry a bounded `message` naming the landing violation and offending path, fails against the pre-fix cause-less settle, and contains an in-body `// @mutate` that reverts terminal cause emission to the cause-less baseline and turns the scoped test red.
- [ ] `v2/src/execution/write-loop-intent-landing.test.ts` — `non-repromptable landing cause truncates oversized rogue path lists`; Mutation checkpoint: the negative case exceeds the shared log-text bound, proves the persisted and composed cause is bounded, and contains an in-body `// @mutate` replacing bounded emission with the raw violation so the scoped test turns red.
- [ ] `v2/src/daemon/run-operator-error.test.ts` — `composeRunOperatorError omits message for cause-less landing_failed`; Mutation checkpoint: the negative case preserves the existing cause-less shape and contains an in-body `// @mutate` that inverts the optional-message guard so the scoped test turns red.
- [ ] `v2/src/daemon/daemon-wait-run-completion.test.ts` proves `list` and `wait` expose the same terminal landing `message` while retaining `landing_failed` / `resume` / retryable semantics.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` `non-success settlement mirrors composeRunOperatorError from terminal log context` proves a terminal landing cause reaches stage `failureDetail.message` unchanged through the existing composition seam.
- [ ] `v2/src/execution/write-loop-intent-landing.test.ts` `intent split landing-contract violation reprompts before settle` stays green with its existing `landing_contract_reprompt` payload and no terminal settle on the repaired iteration.
- [ ] `v2/docs/workflow-runner.md`, `v2/docs/daemon-host.md`, and `v2/docs/v1-behaviors.md` document the bounded terminal cause and its run-log, list/wait, and pipeline-stage projections without implying every `landing_failed` origin has a message.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — terminal intent-split landing-contract failures retain a bounded violation class and offending paths in `loop_finished`.
- `v2/docs/daemon-host.md` — `landing_failed` operator errors optionally project terminal `message` to list/wait and pipeline `failureDetail`.
- `v2/docs/v1-behaviors.md` — record the v2 failure-reporting change against the parity baseline.
