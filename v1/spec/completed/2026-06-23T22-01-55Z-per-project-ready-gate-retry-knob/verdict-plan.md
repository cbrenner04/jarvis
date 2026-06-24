## Verdict

Three refinements are required; two are optional; the rest are already handled.

### Required

1. **Cover the operator-facing progress-log denominator.** The completion ready-gate retry loop emits an `(attempt N/M)` progress message whose denominator `M` currently derives from the hardcoded total-attempts constant in three places (loop guard, retry-check guard, log string), not just the loop bound. The spec's task-checklist phrasing scopes the change to "total-attempt computation," which an implementer can read as the loop bound alone — leaving the log denominator fixed at 3. An operator setting `readyGateRetryBound: 5` would then see "attempt 1/3," a silent regression no current acceptance criterion catches. The spec must either add a checklist line making the log denominator reflect the resolved bound, or add an acceptance criterion asserting the progress log's denominator equals (resolved bound + 1). This is the only finding exposing an uncaught regression and is the priority fix.

2. **Pin nullish resolution semantics.** Because a meaningful `0` is the entire reason the knob exists, the override must resolve with `??` (nullish), not `||` — `||` would silently discard `0` and fall back to the default, defeating the fail-fast use case. The existing `readyCommand` resolution it mirrors uses optional chaining, not `??`, so there is no local precedent for the implementer to copy. Add a one-line decision pinning `??`.

3. **Justify the unprefixed knob name against its scope.** The spec records that the knob affects only the completion-transition gate (decision #4) but never reconciles that narrow scope with the bare `readyGateRetryBound` name, which omits the `completion` prefix carried by the underlying constant. Add a decision line stating the name is deliberately unprefixed because it is the only retry-bearing ready gate (other gates have no retry loop to bound), with a note to rename if another gate gains one. The name is fine; the missing rationale is the gap.

### Optional (terse nudges, not blocking)

- Point the validation work at the existing non-negative-integer config pattern already cited in the spec, so the predicate rejects `Infinity`/`NaN` rather than leaving an implementer to write a `typeof === "number" && x >= 0` check that admits them.
- Record "no upper cap; operator's responsibility" as a deliberate-omission line, converting an apparent oversight into a recorded decision.

### Not required

- Ad-hoc-mode behavior is already pinned by the existing resolution decision (`cfg.projects[project.key]`, no ad-hoc source); an AC for the negative would be low-value test surface.
- The default `2` appearing across the three required doc updates is the documentation-standard's parity-baseline cost, not a spec defect; no deduplication needed.

### Rationale

These harden the implementation-threading seam around `0` and the operator-visible log without touching the spec's structure or acceptance-criteria core. The log-denominator gap is the load-bearing one — it is observable operator behavior the intent implicitly promises (a knob that actually reflects the configured value) and which no current criterion verifies. The two decision lines (`??`, name rationale) name plausible wrong alternatives a competent implementer could otherwise pick, meeting the bar for recorded decisions; the optional nudges do not, hence their optional status.