---
name: out-of-scope-probe-blames-main-for-the-lane-s-own-regression
---

# The out-of-scope probe blamed `main` for a regression the lane itself introduced

## Problem

`ready_gate_out_of_scope` means "every attributable failing path also reproduces on `baseRef`", and it settles `nextAction: "stop"` — no resume, no repair. It is therefore the one gate settlement that both **strands a lane** and **exonerates its diff**. When the base-ref reproduction probe is wrong in the exonerating direction, a real regression is labelled pre-existing and the operator is actively encouraged to merge it.

That happened. Run `75ca2a7a` settled:

```text
readyGateOutsidePaths: ["v2/src/daemon/daemon-run-failure-capture.test.ts"]
readyGateOutOfScopeDetail: "ready gate failing paths also reproduce on main: v2/src/daemon/daemon-run-failure-capture.test.ts"
```

Measured afterwards on an **idle** machine:

| Tree | Result |
| --- | --- |
| `main` | **12 pass / 0 fail** |
| the lane's branch | **11 pass / 1 fail** |

So the failure does not reproduce on `main` at all. It is the lane's own: its change adds a `store.loadRun` call inside `settleFailedWorkflowRun` (`v2/src/daemon/daemon-workflow-admission-handlers.ts:156`), where sqlite `prepare` throws, breaking `a run already terminal at rejection time is not re-demoted but still records the failure`. The existing test caught the regression correctly; the classifier then told the operator to disregard it.

This is worse than the known load-flake shape. The runbook already warns that a saturated machine can make the probe flake the same test it is checking — that costs a stranded lane. This instance costs **a shipped regression**, because the settlement's whole meaning is "not your diff." The same session hit the load-flake shape separately (`daemon-test-lifecycle.sandbox-unrunnable.test.ts`, 3/3 green in both timezones when quiet), so the two failure directions are now both evidenced.

## Decisions

- The base-ref probe must run the failing paths against a tree that actually **is** `baseRef` — the suspicion is it evaluates them without reverting the lane's changes, which would explain a false "reproduces on base" for any lane-introduced failure. Confirm the mechanism before changing the classification. Rules out treating this as flake.
- A probe that cannot establish base-ref behaviour with confidence must not settle `ready_gate_out_of_scope`, because that verdict is load-bearing in the exonerating direction; an inconclusive probe settles the ordinary red gate instead, which is repairable and honest. Rules out inconclusive-is-exonerating on the one settlement that tells an operator to ignore a failure.
- The settlement records the observed base-ref result per path (pass/fail counts, and that the tree was at base) so an operator can audit the exoneration without re-running by hand. Rules out an unfalsifiable claim in a terminal row.
- Scope is the base-ref reproduction probe and the `ready_gate_out_of_scope` settlement. No change to what the ready gate runs. Rules out widening into gate scoping.

## Acceptance criteria

- [ ] A test drives a failing path that passes on `baseRef` and fails on the branch, and proves the run does **not** settle `ready_gate_out_of_scope`; it fails against the current probe.
- [ ] A test proves a path failing on both base and branch still settles `ready_gate_out_of_scope`, so the genuine case is preserved.
- [ ] A test proves an inconclusive base-ref probe settles a repairable red gate rather than the non-resumable out-of-scope verdict.
- [ ] A test proves the settlement records the per-path base-ref observation it based its exoneration on.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Gate trust: `ready_gate_out_of_scope` has been observed wrong in **both** directions; verify the named paths on base and branch before either believing or dismissing it.
- `v2/docs/write-behavior.md` — what the base-ref probe evaluates and what it records.
