Reviewing the implementation and tests against the spec to issue a grounded verdict.
## Verdict: required refinements before merge

1. **Pin the terminally-settled branch guard (`!(anyRejected || anyFailed)`) with a dedicated regression.**  
   The spec requires every new or moved guard in suffix aggregation to carry a `// @mutate` on the real condition and a named test that goes RED when that condition is inverted. This guard is misattributed (points at an observation test) and no test inverts it. Add a row-seed where a terminally settled branch (`rejected` or `failed`) still has a later reachable `pending` row whose predecessors are satisfied, and prove that removing the guard incorrectly defers terminality (e.g. aggregate stays `pending`/`awaiting-approval` instead of `rejected`/`failed` once siblings settle). Correct the `@mutate` link to that test.

2. **Add row-seed coverage for actionable workflow `pending` on a live sibling branch.**  
   The spec explicitly treats reachable unsatisfied non-skipped stages with satisfied predecessors as actionable deferral signals, including workflow `pending` successors. Current regressions cover `running`, approval `awaiting`, and full settlement, but not `failed` branch + sibling with approved gate and next workflow row `pending`. Add a regression proving aggregate state stays non-terminal (`pending`) until that sibling row advances or settles.

3. **Reconcile the stale fan-out state-derivation comment with settlement-first behavior.**  
   Durable docs were updated, but the maintainer-facing comment above fan-out pipeline state derivation still documents global failure-first ordering (`rejected` → `failed` → `running`). It must describe settlement-first suffix aggregation (running and reachable gates/`pending` before terminal `failed`/`rejected` while actionable work remains; rejected-before-failed only after full settlement), consistent with the subspec’s documentation obligation.

4. **Explicitly mutation-pin the observation-path terminally-settled boundary skip.**  
   `derivePipelineBoundary` gained a new guard that skips approval rows on terminally settled fan-out branches. Production code has a `// @mutate`, but the observation regression only documents mutations against aggregation/predecessor guards. Add a test-side `@mutate` that inverts the `fanOutBranchSuffixTerminallySettled` skip and confirm the existing failed-branch + sibling-gate test goes RED—so observation-path guards meet the same “named pinning tests turn RED” standard as suffix aggregation guards.

### Rationale

Core settlement-first behavior, preservation tests, docs, and most mutation checkpoints are in place. The gaps are spec-AC compliance and coverage holes on named signals: an unpinned terminally-settled deferral guard, missing actionable-`pending` regression, misleading inline documentation, and incomplete mutation documentation for the observation alignment. These are narrow, test-and-comment tightenings; they do not require reworking the aggregation design.

### Not required for merge

- Dead-branch `pending` on a `failed` branch at full settlement (rejection preservation test + break-on-first-unsatisfied already exercise the invariant).
- `pipeline_wait` symmetry for `rejected` + `running` (state derivation is pinned; wait flows through it).
- Rejected-before-failed row-seed at full settlement (ordering preserved in code with separate `@mutate` on terminal returns; no explicit AC).
- Observation test seed consistency (`gate/beta: awaiting` with `plan/beta: succeeded`) — fidelity nit only.
- `intent.md` unchecked boxes — planning artifact; subspec ACs are satisfied.