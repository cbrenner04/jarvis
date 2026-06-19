## Verdict: refine before merge

The draft matches intent scope (investigation-only, `finding.md`, no harness change) but is not executable against real telemetry as written. Several AC/task pins conflict with the merged stall-diagnostics contract and v1 correlation shape.

### Required refinements

**Prerequisites**
- Add `## Prerequisites` naming merged stall-diagnostics instrumentation (`last_output_age_ms`, `watchdog_descendants_alive` on `watchdog-iteration-timeout` rows). Without this, plan mode cannot block runs on missing diagnostics.

**Population and candidate filter**
- Pin corpus: patch mode only (`mode: "patch"`); `exitReason: watchdog-iteration-timeout` only — not `iteration-timeout` (no diagnostics by design). Record that exclusion and note possible bias in the finding when non-watchdog timeouts may matter.
- Replace “at or near full `iterationTimeoutMs`” with an objective filter on row `duration_ms` (e.g. ≥ configured timeout minus a fixed margin, or ≥29m when default 30m applies). Rules out quota-early and ambiguous near-miss rows.

**Corpus underflow**
- ≥3 cited cases remains the target, but only from post-instrumentation rows after exhaustive search. If fewer than 3 qualify, execution must append `## Blocker` with count and date range — not fabricate cases or silently lower the bar.

**Evidence contract (AC ↔ instrumentation)**
- Drop “full” / mandatory-per-field language. Each case cites **available** fields per stall-diagnostics: when pgid known, include `watchdog_descendants_alive` and optional `watchdog_pgid` plus `[watchdog]` suffix when emitted; when pgid unavailable, cite `last_output_age_ms` from telemetry, note pgid-unavailable, and use iteration banner / harness stderr — no `[watchdog]` line required.
- Replace nonexistent `run_id` / “iteration index” with telemetry correlation: `namespace` + row `ts` + `iteration`. AC must require cited values match identifiable `runs.jsonl` rows on those keys.
- Pin session-log traceability: log file for `namespace` whose time window contains the row `ts`; iteration section = lines between that iteration’s start marker and the next iteration or run end.

**Classification rubric**
- Add load-bearing per-case rules keyed to diagnostics + log context:
  - `hung-subprocess`: pgid known, `watchdog_descendants_alive: true` at snapshot.
  - `agent-idle`: pgid known, `watchdog_descendants_alive: false`, and `last_output_age_ms` null or skewed toward full timeout — explicitly **not** “model thinking”; operational “no output + no in-group descendants.”
  - `other`: pgid unavailable, orphan-escape pattern (`setsid` escapees → false-negative liveness per `run-loop.md`), or inconclusive logs.
- Require log-context check for escaped descendants; do not classify those as `agent-idle` without noting minority/`other`.
- Dominant cause: single category if majority; otherwise `mixed` with counts. Idle-bound verdict must address `mixed` explicitly.

**Idle-bound verdict**
- Couple verdict to dominant cause: output-idle bound sketch only when dominant (or majority idle component) is `agent-idle` or idle-weighted `mixed`. Dominant `hung-subprocess` → `not-warranted` for idle-output bound unless finding gives explicit alternate remediation rationale.
- “Sketch a bound” = output-idle span under `iterationTimeoutMs`, reset on stdout/stderr — aligned with `idle-output-watchdog` intent, not wall-clock shrink. Config key/default stay deferred to first consumer (already correct).

**Decision ledger**
- Expand `## Decisions` with the pins above that rule out plausible wrong alternatives (post-instrumentation-only corpus, pgid-unavailable path, patch-only population, rubric, tie-break, verdict coupling, Blocker on thin corpus). Drop or tighten entries that only restate intent.

**Acceptance criteria framing**
- Lead AC with external correlation to `runs.jsonl` / session logs, not prose self-grade. `finding.md` as spec-tree evidence home per `documentation-standard.md` is defensible for this harness investigation subspec; optional forward link to `idle-output-watchdog` prerequisite path is acceptable, not required.

### Not required

- Split into multiple subspecs — precision gaps are internal to one investigation slice.
- Mandatory extraction-command “Method” section or downstream AC coupling to `ready-intents/` — optional review aids only.
- Durable `v1/docs` or `v2/docs` edits — correctly out of scope.

### Rationale

Intent requires per-iteration evidence from real stalls and a grounded idle-bound judgment. Current AC mandates fields and log excerpts that instrumentation deliberately omits on pgid-unavailable timeouts, so a conforming implementer could not satisfy acceptance without excluding real rows or misclassifying them. Correlation keys and classification rubric gaps would produce non-reproducible labels and idle-bound sketches disconnected from dominant cause — undermining the remediation gate this slice exists to unlock.
