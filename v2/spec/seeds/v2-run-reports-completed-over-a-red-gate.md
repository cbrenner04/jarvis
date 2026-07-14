# A v2 run reports `completed` over a red gate, and the repair loop never fires

An implement workflow ran its ready gate, the gate was red, and the run still reported
`runStatus: "completed"` and published a PR. The `red-gate-feeds-back-to-the-agent` repair loop did
not engage. **`ready_gate_repair` has never been emitted — not once, in any run, ever.**

This is the v2 instance of `run-cannot-report-complete-over-red-gate`: a terminal status asserted
without the evidence that would substantiate it.

## Problem

Observed 2026-07-14 on `main` at `d7b36f5e`. Spec
`20260714T145402Z-resume-stopped-write-run-from-snapshot`, runs `31b49a89` (write) and `154ef308`
(publication), PR #1575.

The operator-facing result:

```json
{"runStatus":"completed","loopOutcomeKind":"complete","iterationsConsumed":5,"resumable":false}
```

The publication run's log, however, ends:

```
loop_finished  complete
loop_finished  ready_finalize_failed
```

And the gate is genuinely red at the **pushed commit** `cfa6fc1a` — verified on a clean tree, with
no operator edits:

```
× Formatter would have printed the following content:   (×2)
× Excessive complexity of 34 detected (max: 24).        daemon.ts — run-list row builder
× Excessive complexity of 27 detected (max: 24).        daemon.ts — resumeHandler
```

So a run whose gate failed told the operator it completed, and left a PR open over the red commit.
The operator only found out by running the gate by hand.

## `ready_gate_repair` has never fired

```sh
$ grep -c ready_gate_repair ~/.jarvis/state/logs.jsonl ~/.jarvis/daemon.log
logs.jsonl:0
daemon.log:0
```

`red-gate-feeds-back-to-the-agent` (#1560) shipped a bounded 3-attempt repair loop and was merged
unverified — the runbook already flags that no `ready_gate_repair` event had ever been observed. This
run is the first red gate since, and it still did not fire. The repair loop is, in practice, dead
code. All four biome errors here are exactly the mechanical class it was built to fix
(`bun run fix` cleared the formatter ones outright).

## Two candidate mechanisms — the spec must determine which

1. **The gate ran, went red, and the run settled `ready_finalize_failed` without routing through the
   repair loop.** The runbook says "flip failures are not repaired" — if a red *gate* is being
   classified as a *flip* failure, the repair loop can never arm. Note this run's finalize failure is
   entangled with `failed-ready-flip-strands-the-run-and-hangs-the-cli`: the same
   `ready_finalize_failed` outcome is produced by a failing `gh pr ready`, so the two are currently
   indistinguishable from the outside.
2. **The gate never ran in-run**, and the red state was only discovered by the operator. Compose with
   `v2-worktree-has-no-dependencies-so-the-agent-cannot-gate`.

Either way the operator-visible defect is the same and is the priority: **`completed` must not be
reachable over a red gate.**

## Scope

- A run whose ready gate is red never reports `completed`. It reports a distinct, named failure.
- A red gate routes to the repair loop before any terminal settle, and emits `ready_gate_repair` when
  it does.
- A gate failure and a publish/flip failure are distinguishable in the run log and in `run list`.
  Today both land as `ready_finalize_failed`.
- Regression coverage asserts a red gate cannot produce `runStatus: "completed"`, and asserts the
  repair loop emits its event — the coverage gap that let #1560 merge unexercised.

## Decisions

- `completed` means the gate was green. Rules out any terminal-success path that tolerates a red
  gate, including "the PR is published, the operator will notice."
- Assert on the repair loop's *evidence* (`ready_gate_repair` events), not on the run reaching a
  status. #1560's tests pass while the loop never runs — the same class of blind spot as
  `tui-tests-bypass-the-render-path` and the silent-no-op review step.
- Separate the gate-failure and flip-failure outcomes before fixing either. Rules out debugging
  through a shared, overloaded `ready_finalize_failed`.

## Out of scope

- Making the biome rules themselves easier to satisfy.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove the "#1560 is not verified end-to-end" caveat only when
  `ready_gate_repair` is actually observed; until then, state that a `completed` v2 run does **not**
  imply a green gate, and that the operator must re-gate by hand.
- `v2/docs/workflow-runner.md` — gate-red vs flip-failed outcomes, and repair-loop ordering.
