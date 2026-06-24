## Verdict

The draft's decision record is strong and its scope is correct, but several findings hold up and must be pinned before implementation. Required refinements:

1. **Pin where the exit-code split is produced.** The current task item ("classify failures *so the caller can distinguish them*") mis-locates the work. The review phase's execution-failure paths and its two gate-red paths already originate at distinct source sites, so the phase itself can emit `11` for execution failures and leave the gate-red paths returning `1`; the completion-pipeline caller propagates the integer unchanged. The spec must state this mechanism explicitly (review phase returns the discriminated code at its source) rather than implying a new caller-side contract.

2. **Resolve the operator-message contradiction.** One acceptance criterion promises a message that *names the underlying review failure reason* (quota-exhausted vs commit-failed vs idle-timeout). The message is built solely from the exit integer, which cannot carry that distinction. The spec must either (a) soften the AC to a generic review-incomplete message (PR left draft, recovery via `--resume-review` or manual finalize), or (b) specify a reason carrier that reaches the message path. Pick one; the draft currently promises (b) while the design supports only (a).

3. **Address exit `11` colliding with agent-CLI exit codes.** `11` becoming a meaningful harness sentinel means a reviewer agent CLI that coincidentally exits `11` could be misread as `review-incomplete`. The spec must decide whether `11` joins the reserved/normalized exit-code set (so a coincidental agent `11` is collapsed) and add a corresponding task item.

4. **Decide the escaped-throw path.** A review-phase throw that escapes and is caught by the completion pipeline currently flattens to `1`. Since this is a genuine "review couldn't run" infra failure, the spec must state whether it maps to `11` or stays `1`.

5. **List the contradicted test as a required change.** A `run.test.ts` case asserts the review-quota-exhaustion scenario exits `2`; the headline AC reroutes that exact scenario to `11`. The draft lists tests that must *stay green* but omits this one, which must *change*. Add it explicitly to the task checklist alongside the `v1-behaviors.md` updates.

6. **Fix the baseline-gate-red rationale.** The "completion gate guarantees green, so baseline-gate-red is unreachable" justification holds only on the completion path; `--resume-review` (explicitly in scope) can re-enter against a stale/red tree, making that path reachable. Keep the mapping (baseline-gate-red stays `1`) but rejustify it as "a red tree is a real error regardless of how review was entered," covering both paths.

7. **Disambiguate idle-timeout scoping.** Exit `8` is shared with implementation-phase idle-timeout. Add a one-line decision that only the review-phase idle-timeout sites remap to `11`; implementation-phase `8` is unchanged.

8. **Resolve the two undecided sub-cases.** The decision matrix omits (a) **blocker-commit-failed** — a blocker that failed to commit (infra failure of a blocker), which currently exits `1` and would default into the "stays 1" bucket likely incorrectly; and (b) the **actuator no-agents** exit-`2` path — confirm it maps to `11` under "all review agents quota-exhausted." Add an explicit line for each.

The structural-AC concern is not upheld: this is a harness subspec, so naming internal symbols and exit codes is permitted, and the refactor-preservation ACs correctly use the cite-the-test form.

Rationale: these are not scope or intent changes — the intent (distinguish review-only failure from implementation failure as a partial outcome) is sound and unaffected. Each refinement pins mechanism the draft left implicit, closing gaps where an implementer would plausibly choose wrong (overloaded exit `1`, an unsatisfiable message AC, a silently contradicted test). This aligns with the spec-guidance requirement that decisions name the wrong alternative they rule out and that behavior-changing specs accurately enumerate the existing tests and v1 behaviors they alter.