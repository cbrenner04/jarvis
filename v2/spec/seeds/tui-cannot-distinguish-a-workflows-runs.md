# TUI cannot distinguish a workflow's runs from each other

## Problem

One `jarvis run workflow implement --review-passes 1 --review-behavior debate` invocation produced
two durable runs. Both render identically in the TUI, so the operator cannot tell which is the
implementation and which is the review, nor whether either did real work:

```text
Workflow
  implement implement pending attempts=0
  implement-review actuator completed complete attempts=0
Outcome
runStatus: completed
loopOutcomeKind: complete
iterationsConsumed: 1
resumable: false
```

Three distinct defects in that panel:

1. Two rows for one spec with one subspec, with nothing identifying which run each is.
2. The `implement` step reads `pending` on a run whose outcome is `completed` — the step
   snapshot and the run outcome disagree.
3. `attempts=0` on every row, including rows that provably invoked an agent, so the count
   carries no information.

Observed 2026-07-20 on `20260721T005518Z-cleanup-stranded-owner-by-branch`.

## Decisions

- Each durable run row in the TUI identifies its workflow role (implementation vs review pass) and
  its parent workflow invocation; two rows from one invocation must be distinguishable without
  cross-referencing the store.
- A terminal run's step snapshot must not report `pending`; reconcile the step state at the
  completion boundary so the panel agrees with the outcome.
- `attempts` reflects actual agent invocations for the step; a step that invoked an agent never
  reads `0`. Rules out leaving a placeholder counter on display.
- Presentation-layer only where possible: prefer surfacing state the store already holds over
  new persisted fields; add a field only where the data genuinely is not recorded.

## Acceptance criteria

- [ ] Two runs from one workflow invocation render with distinct, role-identifying labels in the TUI.
- [ ] No terminal run renders a `pending` step; step state at the completion boundary matches
      the run outcome.
- [ ] `attempts` equals the step's agent invocation count and is non-zero for a step that invoked
      an agent.
- [ ] Coverage asserts the rendered rows (not just view-model state) for a two-run workflow —
      see `v2/docs/test-writing.md` on TUI tests bypassing the render path.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — reading a multi-run workflow in the TUI.
