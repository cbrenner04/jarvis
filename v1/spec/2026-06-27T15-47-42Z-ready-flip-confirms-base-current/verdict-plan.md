## Verdict

Seven refinements are required. One finding is dismissed.

---

**1. ACs 7–8: "stay green" wording overpromises**

The guard is inserted before the `markReady` seam. Existing tests that inject `markReady` will now also invoke the guard's real git/gh calls unless `checkBaseCurrent` is also injected. The "stay green" language implies no test changes, which is false. The ACs must be reworded to acknowledge that existing fixtures require `checkBaseCurrent` seam injection to remain passing, and Task 5 must name that fixture update explicitly.

**2. Helper module location must be decided**

The spec introduces a shared helper that calls only git/gh with no v1 imports. Whether it lives in `shared/` or `v1/src/` is an architectural choice that a competent implementer could plausibly get wrong. A decision is required naming the module home.

**3. "Diverged" branches must be treated the same as "behind"**

`git merge-base --is-ancestor origin/<base> HEAD` exits non-zero for both strictly-behind and diverged branches. The current spec text says "behind," but a diverged branch has base commits absent from HEAD — the same root problem. The spec must name this explicitly so an implementer doesn't add a fast-forward-only interpretation.

**4. Fetch-failure test case missing from task checklist**

AC 6 states the soft-fail behavioral requirement but no task item calls for a test covering the fetch-failure / base-resolution-failure path. This is the most likely regression point. Task 5 must enumerate it.

**5. `markReady` seam callers must co-inject `checkBaseCurrent`**

The guard runs before the `markReady` short-circuit. This changes the behavioral contract of the `markReady` seam: callers who inject it to skip the flip also implicitly skip the guard only if `checkBaseCurrent` is separately injected. The spec must state this as a decision and the task checklist must name the required co-injection update.

**6. Remote name `origin` is assumed but undecided**

Every decision references `origin/<base>` without stating that `origin` is the assumed remote name or that a missing remote falls into the fetch-failure soft-fail path. Add a one-line decision.

**7. Dismissed — message content unspecified**

AC 3 constrains the message to name both branch and base. That is sufficient for the implementer to produce a correct, verifiable output. Prescribing exact wording is over-specification for operator UX that can be adjusted post-merge.

**8. TOCTOU nature should be acknowledged**

The guard is presented as a gate but is inherently best-effort: the base can advance after the check and before the flip. Since fetch errors already soft-fail (proceed), the feature is already best-effort by design. The Problem or Decisions section should name this once so an operator who observes a post-guard stale merge doesn't conclude the guard is broken.