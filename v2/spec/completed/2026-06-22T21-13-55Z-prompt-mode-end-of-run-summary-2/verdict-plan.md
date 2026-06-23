All key claims are confirmed against source. Verdict follows.

---

# Adjudicator Verdict — UPHELD (refinement required, decomposition sound)

The two-subspec split (builder in `00`, wiring in `01`), the `promptSummary`-not-`runSummary` choice, the three-way `recordMatchesMode`, and the deferred-to-first-consumer markers are all sound and stand. The following refinements are required before this spec is implementation-ready.

## Required refinements

### R1 — `00`: decide and grade the `spec:` line for a specless mode (load-bearing)
The shared builder `renderSummaryFromRecords` unconditionally renders `spec: <specPath>` (run-summary.ts:235), and `planSummary`'s no-telemetry fallback hardcodes a `spec:` line too (run-summary.ts:517). Prompt mode has **no spec path** — "mirror planSummary's shape" silently inherits a line that has no meaningful value to fill. This is the spec's one genuine design gap.

`00` must make an explicit decision: parameterize the builder so `promptSummary` suppresses or relabels the `spec:` line (and any other spec-coupled header), rather than emitting an empty/placeholder one. Add an acceptance criterion that grades the rendered header set for the populated case — the current ACs enumerate every rendered line *except* `spec:`, leaving the one ill-fitting line ungraded.

### R2 — `00`: pin the no-telemetry fallback header set (tail of R1)
`planSummary`'s fallback emits title + `spec:` + `exit reason:` + `phase attempts: 0` + `duration:` + the sentinel. The spec mandates the fallback *sentence* but not which header lines precede it. `00` must pin the prompt fallback's header lines (no `spec:` per R1, no `phase attempts:`, no `iterations:`, consistent with the existing single-pass decisions) and add an AC covering them — not just the `(no telemetry records found for this run)` text.

### R3 — `00`: state the `recordMatchesMode` predicate literally
The decision argues for a three-way match but never writes the predicate. State it: `patch → mode === "patch"`, `prompt → mode === "prompt"`, `plan → mode === "plan"`. The existing "patch no longer matches a `mode: prompt` record" AC already implies strict `patch`; making the predicate explicit closes the gap between rationale and contract.

### R4 — `01`: pin the telemetry write sites and the `finally` guard
There are exactly two success termini — no-diff `return 0` (run.ts:~380) and post-PR `return 0` (run.ts:~440); all failure paths (`return 1`) fall through to the `finally` write (run.ts:~452). "Move the write ahead / don't double-write" under-specifies the result. `01` must state that the enriched row is written **at each success terminus**, and that the `finally` block writes only when no terminus already wrote (a write-once guard), so failure paths still emit exactly one row. Keep the existing "exactly one row per run" AC.

### R5 — `01`: capture diff-path duration at the terminus
`durationMs = Date.now() - runStartedMs` is currently computed in `finally` (run.ts:~452), i.e. after commit/push/`gh pr create`. If the diff-path row is written at its terminus, duration must be captured **after** PR creation to preserve today's wall-clock semantics; otherwise `duration:` silently understates by the git/push/gh time. `01` must state the diff-path duration capture point.

### R6 — `01`: pin no-diff stdout ordering
The no-diff path already prints `opts.io.stdout(agentOutput)` (run.ts:~380). Adding the summary block + outcome line yields two stdout payloads with unstated order. `01` must state the order (e.g. agent output, then summary block + outcome line) and grade position in the AC, not just "stdout contains" both.

### R7 — `01`: note the loop-scoped `result` hoist and the `gh` encoding requirement
Two implementation hazards the checklist should name so they aren't missed:
- The `ok` `result` that `extractUsageAndCost` consumes is currently loop-scoped; only `agentOutput`/`agentSuccess` escape the agent loop. The checklist must say the `ok` result is hoisted out of the loop.
- The `gh pr create` call passes `stdio: "pipe"` but **no `encoding`** (run.ts:~433), so its return value is not a string today. Capturing the PR URL requires adding `encoding: "utf8"` and trimming. Note this in the checklist item.

## Rationale
R1/R2 are the substantive gap: a specless mode forced through a spec-shaped builder leaves a load-bearing rendering decision unmade and ungraded, violating the principle that acceptance criteria grade observable output. R4/R5 are the telemetry-write/duration sequencing the intent itself flagged as a plan-time question — the spec names the problem but resolves less than it claims; getting one row, correct cost, and correct duration on both termini is the core behavioral contract. R3/R6/R7 are clarifications that prevent foreseeable implementer ambiguity. None require redesign; all are addressable by tightening `00`'s builder-parameterization decision and `01`'s sequencing decisions.