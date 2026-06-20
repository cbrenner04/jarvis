## Verdict

Three findings are upheld and require action. Two are dismissed.

### Required outcomes

1. **The `off` switch must have runtime test coverage.** This is the spec's headline feature, and subspec 00's acceptance criteria #3–#5 assert observable runtime behavior — with `modes.patch.shrink: "off"` and an otherwise shrink-eligible completion, the shrink phase does not run (no pre-shrink ready gate, no `patch_phase: "shrink"` telemetry row), while review placement and `maybeMarkReady` are unchanged. These criteria are currently graded complete, but the only tests added exercise config loading/validation, not phase behavior. The single behavioral change is one conjunct on the shrink-eligibility predicate in `v1/src/modes/patch/run.ts`. A phase-level test must set `shrink: "off"` and assert (a) no shrink telemetry row is emitted on a shrink-eligible completion, and (b) review still runs when `modes.review.passes > 0`. **Rationale:** the quality bar requires acceptance criteria to grade behavior reachable in a real run; runtime ACs checked off with no runtime test do not meet it.

2. **The two "will shrink run?" predicates must be reconciled.** The shrink-eligibility gate now carries the `!== "off"` term, but the earlier predicate that decides whether `maybeMarkReady` defers does not. This is presently benign only because a downstream safety net re-invokes `maybeMarkReady` in the same flow — correctness now rests on a code path not designed to guarantee it. Align the two so the `off` case is expressed once (shared predicate or matching condition), removing the latent divergence. **Rationale:** silent divergence of two expressions of the same intent is a latent-correctness hazard even when currently masked.

3. **Restore explicit-`agent` config coverage.** Subspec 00 AC #1 names both values ("`off` or `agent` loads successfully"), but the explicit-`agent` validation case was removed (incidentally, by a self-shrink commit). The no-field default-resolves-to-`agent` test exercises absence, not explicit-`agent` passing validation. Restore a one-line assertion that an explicit `agent` value loads. **Rationale:** the AC enumerates that value; coverage should match the criterion.

### Dismissed

- **Decision wording vs. porcelain check (subspec 01):** the divergence is reachable only if the shrink agent manufactures its own mid-phase commit, which the phase does not do; the implementation is correct for the actual control flow. The wording lives in a spec file, which is not editable in this pass — no actionable outcome.
- **`intent.md` stale scope:** the intent is a frozen planning seed capturing the original ask; the scope cut to `off | agent` is recorded authoritatively in the verdict-plan. No durable doc is misleading. No action required.