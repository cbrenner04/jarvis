Reviewing the implementation against the spec and acceptance criteria to issue an outcome-focused verdict.
## Verdict

### 1. First-painted-pipeline mutation guard does not match its acceptance criterion

The subspec requires that reintroducing `ids[0]` (and backward) fallthrough in `selectNextRun`/`selectPreviousRun` turns the first-painted-pipeline descend pin red, and that the pin’s `Mutation checkpoint:` names that fallthrough.

Descend-expand returns before the general `indexOf === -1` path. Reinstating fallthrough only there leaves the pin green while the checkpoint claims it would go red. The pin still checks the right operator behavior (first child after `j` on the top pipeline row), but the mutation guard and AC wording target a regression path this test cannot catch.

**Required outcome:** The first-painted-pipeline descend pin must guard the regression it names—either the checkpoint must detect fallthrough reinstatement that would break the pin, or the checkpoint and AC must align on the actual guarded failure (descend-expand without first-child selection, or equivalent). After the change, reintroducing the pinned regression must turn the pin red.

**Rationale:** Spec AC #79 and the tasks’ mutation-coverage requirement treat this pin as a fallthrough guard. A no-op checkpoint weakens regression detection for the core descend bug class and marks an AC satisfied without the claimed guard property.

---

### 2. No other required actuator work

Implementation matches the subspec for scroll-follow (tree rows, full-flatten index space, minimal offset), `indexOf === -1` no-op, membership after nav, monitor-lines scroll offset without trimming selectables, and durable doc updates scoped to tree scroll-follow.

Stale `intent.md`, unattributed/queue scroll-follow, sub-second resize without `setState`, run-leaf viewport coverage, expansion-collapse reclamp pins, and `withLeftPaneTreeScrollFollow` unit tests are out of scope or optional hardening—not merge blockers for this slice.