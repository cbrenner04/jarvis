# Adjudicator verdict: TUI elapsed columns

## Required refinements

### 1. Close the 8-column formatter guarantee in subspec 01

The intent requires elapsed strings never exceed the 8-column budget, with no ellipsis truncation. Subspec 01 pins tier *boundaries* (`59s`/`60s`, `3599s`/`3600s`, `86399s`/`86400s`) but not worst-case strings inside a tier. The day tier (`Nd Nh`) can exceed 8 code units for large `N` (e.g. `100d 23h`), and `formatTreeCell` ellipsis would then become a silent second truncation path in subspec 02.

**Required outcome:** Subspec 01 must make the width guarantee unconditional—either via acceptance criteria that pin max-width samples per tier (including an explicit overflow case in the day tier) or via a documented formatter decision that caps day-tier display so every valid output is ≤ 8 code units. Tasks and acceptance criteria must agree; remove the current gap where tasks mention max-width pins but ACs do not.

### 2. Document terminal-freeze edge cases in subspec 02

Freeze is keyed on recorded end timestamps (`finishedAtMs`, `endedAt`), not terminal status. A row that looks finished but lacks an end timestamp continues to tick elapsed against `nowMs`—consistent with the spec formulas but easy to misread against intent wording (“terminal rows freeze”).

**Required outcome:** Subspec 02 documentation acceptance criteria must state explicitly: elapsed freezes only when the recorded end timestamp is present; rows without `finishedAtMs` / `endedAt` keep advancing on the local tick even if status is terminal.

### 3. Document collapsed-workflow run elapsed in subspec 02

Run elapsed uses `run.createdAt` uniformly via `monitorTreeCellValue`, including workflow-collapsed rows (representative run timestamps). That behavior is implied but not stated for operators.

**Required outcome:** Operator-facing docs tasked in subspec 02 (`operator-runbook.md`, and `v1-behaviors.md` if it covers the same semantics) must note that collapsed workflow rows show elapsed from the representative run’s `createdAt` / `finishedAtMs`.

### 4. Acknowledge fixture churn scope in subspec 00

Making `createdAt` required on `DaemonListRunRow` will force updates across many test literals. Typecheck and `test:v2` catch omissions, but implementers benefit from explicit scope.

**Required outcome:** Subspec 00 tasks should note that the type change requires updating `DaemonListRunRow` fixtures repo-wide, not only the new pin test.

---

## Not required

- **Split subspec 02.** Rendering and local display tick are distinct verification surfaces but one operator-visible behavior sharing a single `nowMs` injection point. Existing ACs already separate pure row-builder pins from the RPC-count integration pin; a fourth subspec would add routing overhead without fixing a coverage hole.
- **Dedicated subspec for the `projectPipelineSnapshot` stage-timestamp prerequisite.** It is already committed and pinned in daemon tests; a regression surfaces through subspec 02’s stage-elapsed ACs.
- **`test:integration:v2` in spec ACs.** No planned integration surface; `test:v2` plus repo `AGENTS.md` scoping is sufficient for this work.
- **Additional ACs for negative/zero duration or `startMs === nowMs`.** Subspec 01 decisions cover these; primary operator cases are adequately pinned.
- **Prescribing `MonitorPipelineTreeStageNode` shape or display-tick internals.** Implementation choices; the spec’s behavioral ACs are sufficient.

---

## Rationale

Refinements 1–3 close real contract gaps: an unconditional width guarantee the intent asserts but ACs do not fully prove (#1), operator semantics that contradict casual reading of “terminal freeze” (#2), and collapsed-row behavior that exists in code but is undocumented (#3). Refinement 4 is scope clarity to reduce implement friction on subspec 00. Everything else is either already covered, convention-acceptable, or optional task-level detail that does not block spec merge.