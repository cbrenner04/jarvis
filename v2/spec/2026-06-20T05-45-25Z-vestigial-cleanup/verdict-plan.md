# Adjudication Verdict

Both reviewers agree on the factual core, and I concur after weighing the scope arguments. The spec is fundamentally sound — the dead-path analysis is accurate and the doc-drift claims check out. Two issues are load-bearing and must be fixed; several minor ones improve correctness cheaply.

## Required refinements

**1. Reconcile the second non-index behavior entry (load-bearing).**
Subspec 00 only updates the `[v2-cleanup candidate]` block in `v2/docs/v1-behaviors.md`. A *separate* entry in that catalog documents non-index runs inlining the operator-passed subspec path/body into the active-subspec block without index routing — the exact behavior killed by removing the `: specPath` fallback. Leaving it stands rots a sibling entry while the spec claims to de-rot the catalog. Subspec 00's task checklist, AC#3, and Documentation-updates must name *both* the candidate block and this second entry, so every changed v1 behavior is reconciled. This is the standing parity-baseline rule the spec exists to honor.

**2. Correct subspec 00's test instruction (load-bearing).**
The `confirmRun` seam is exercised only by tests that return empty/`e` — both exit at preflight. No test ever drives the non-index iteration; it is unreachable even via the seam. The task item "update/remove any test that drove the non-index iteration via `confirmRun`" therefore points at a test that does not exist, and an implementer hunting for it may delete the preflight-prompt tests that back AC#2 — destroying the coverage the spec demands be preserved. Invert the item: state explicitly that the preflight-prompt tests must be **kept**, and that there is no iteration test to remove. Correspondingly, fix the catalog clause asserting the path is "reachable via the test-only `confirmRun` seam" in the same edit (it is inaccurate).

**3. Tighten AC#2 to the two real preflight shapes (minor).**
The `[s]` option renders only when a sibling `index.md` exists; a sibling-less non-index spec shows only `[e]`. AC#2's "`[s]`/`[e]` prompt" can be misread as requiring `[s]` unconditionally. Phrase the criterion to mirror both cases (sibling present → `[s]`+`[e]`; absent → `[e]` only).

**4. Record the orphaned `buildPrompt` branch as an explicit deferral (minor).**
Removing the `: specPath` fallback leaves `buildPrompt`'s non-index inlining branch without a production caller — fresh vestige created by a vestigial-cleanup spec. Keeping subspec 00 atomic by deferring this is legitimate, but it must be an acknowledged inline deferral, not a silent side effect. Add a one-line out-of-scope/deferral note naming the now-unexercised branch.

**5. Make subspec 01's `refine` parse-but-not-emit call explicit (minor).**
Subspec 01 correctly notes `RESUME_SUBJECT_RE` still parses `refine` for legacy resume-index computation but never emits it. The deliverable should explicitly decide whether the corrected doc keeps a one-line "`refine` parsed-but-not-emitted" note explaining why the regex retains the token — rather than leaving that to implementer discretion.

**6. Require verification (not editing) of retained commit entries in subspec 01 (minor).**
The retained `review`/`draft`/`blocker` commit entries should be confirmed against `commits.ts` as still-correct, so "kept" means "verified correct." Note that the review-commit-format drift remains out of scope per Decision 1 — verify-and-leave, do not fix.

**7. Optional: note the `*TempPlanState` naming trap.**
`cleanupCommittedTempPlanState` is unrelated error-cleanup invoked with the final plan name, not a temp-slot artifact. Since subspec 01 rewrites the "temp slot" narrative, a one-line out-of-scope note prevents a `temp`/`tmp` grep from misdirecting an edit. Helpful, not required.

Findings #1 and #2 are the gating fixes — in both, the spec as written would undercut its own stated intent. The remainder are low-cost precision improvements consistent with the inline-deferral and parity-baseline discipline the repo requires.