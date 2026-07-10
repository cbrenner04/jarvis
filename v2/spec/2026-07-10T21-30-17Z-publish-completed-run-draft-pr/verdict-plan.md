# Verdict — Refinement Required

The critique is well-grounded. Most findings are valid and load-bearing. Refine the spec to address the following.

## Must-fix (load-bearing)

**1. The "established bounded retry policy" has no v2 implementation to cite.**
No retry/backoff/classification seam exists in `v2/src` (step-runner explicitly states "no hidden retries"); the only such policy is v1's, documented but not ported. Decision 8 and AC 6 reference "the established bounded retry count, classification, backoff, and retry notice" as if a v2 helper exists to reuse — it does not, so AC 6 is currently unverifiable. The spec must resolve this by either:
- declaring that this work **creates** the v2 retry seam and **pinning the concrete values** (count, backoff, transient-vs-permanent classification, retry notice), or
- naming a **prerequisite** that establishes the seam and citing it.

Because this spec is the *first consumer* of that policy, the repo's "defer invented precision to the first caller" rule does not license a gesture here — the numbers must be pinned, not implied.

**2. "`gh` readiness" gates on an undefined check.**
No `gh`/GitHub integration exists in `v2/src`; readiness is v1-only behavior. Decision 7 / AC 5 assert a behavior ("failed `gh` readiness → retryable failure") whose subject has no definition. Since AC 5 tests it, it cannot be deferred — the spec must give "readiness" a concrete, verifiable meaning (e.g., binary presence and/or an auth-status probe) so an implementer and reviewer agree on what AC 5 checks.

## Should-fix (small, real, in-scope)

**3. Non-fast-forward push is unclassified.** Decision 3 covers only upstream-vs-no-upstream. A diverged remote branch yields a non-fast-forward rejection that is **permanent** (retrying won't fix it), not transient. Add a decision distinguishing non-ff rejection (stop, no retry) from transient network failure.

**4. Reuse-not-reconcile wording.** Decision 4 and the intent language ("reconcile/refresh") overpromise: every AC covers only *initial* PR creation, and title/body mutation is deferred. Body-refresh and ready-flip belong to the downstream finalize spec. Restate Decision 4 as plain **reuse of the existing open PR without content mutation** and cross-reference the downstream spec, tightening the boundary.

**5. Missing negative skip ACs.** This work inserts a publisher into completed-run paths that include publish-disabled and non-git-backed branches. Add ACs pinning that a **publish-disabled** or **non-git-backed** completed run skips push/PR entirely — the regression fence for those existing guards.

**6. Once-per-workflow publication not pinned.** Workflow steps run without publication; the runner publishes once after all steps and shrink. AC 1 says "workflow run pushes" but does not pin **once-per-workflow, not per-step**. Add an explicit AC; per-step publication would double-push.

## Cheap tightening

**7. Record the `baseRef` contract.** Today `baseRef` is a plain local branch start-point name (used verbatim in branch creation), which is valid for a PR base — but the invariant is incidental, not stated, and an operator could supply a remote-qualified ref. Record a one-line decision: baseRef is the run's local base branch name, used verbatim as the PR base.

**8. Route non-GitHub / missing-origin remotes.** One sentence stating these resolve through the `gh`-preflight or push-failure paths (retryable stop, durable boundary preserved) rather than a silent skip, so an implementer does not invent a third behavior.

**9. Multi-PR-per-head tie-break.** Decision 4 says "*the* open PR whose head is the current branch" with no tie-break. Add one line resolving the (rare) multiple-open-PR case — match on `baseRef`, since baseRef is already the PR base input.

## Structural (recommended, not blocking)

Findings 1 and 2 confirm both the retry seam and the `gh`-readiness seam are net-new. Combined with push/upstream logic, open-PR lookup, draft creation, and docs, this single subspec plausibly exceeds the ~1000-line reviewability warning. **Consider splitting the net-new transient-retry + `gh`-readiness seam into a prerequisite subspec** that this one consumes. This dissolves findings 1 and 2 (the seam gets its own pinned numbers and tests), gives the sibling finalize spec a named dependency to inherit, and keeps each subspec independently reviewable per spec guidance.

## Rationale

The two must-fix items are the core defect: the spec grades behavior (AC 5, AC 6) against seams that do not exist in v2, making those criteria unverifiable — a direct violation of the "acceptance criteria must be verifiable" and "cite, don't paraphrase" principles. The should-fix items close real classification and skip-path gaps that would otherwise let an implementer choose divergent behavior. The tightening items document currently-incidental invariants so they survive future changes.