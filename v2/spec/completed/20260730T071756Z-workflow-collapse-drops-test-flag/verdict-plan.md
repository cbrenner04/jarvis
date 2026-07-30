Reviewing the cited source and test patterns to ground the verdict.
# Verdict: Required refinements

The spec’s diagnosis, scope, and remedy are sound: remove mutable production test state and prove collapse on the real `buildWorkflowTableRows` path. The draft is not ready for implementation until the verification contract is tightened. Required outcomes:

---

## 1. Reconcile task and acceptance criteria on whether a new test is required

The task hedges (“if the positive render tests already pin the guard”) while the guard-inversion AC unconditionally demands “replacement guard-inversion coverage,” which reads as a mandatory new `test()`. The existing `collapsed table shows one top-level row for a multi-run workflow` already turns red when collapse grouping is removed (three constituent runs → three top-level rows; test expects one). That is stronger positive proof than the deleted invert test, which stayed green via the flag alone.

**Required outcome:** Task and AC must agree. State explicitly that a new automated test is **not** required when the existing positive render test plus a named comment checkpoint satisfy inversion—matching the `daemon-workflow-start.test.ts` / `workflow-runner.test.ts` pattern. Remove the contradictory hedge or narrow the AC to match.

---

## 2. Name the pinning test(s) and the bypass mutation target

The guard-inversion AC describes behavior without anchoring to a specific test file, test name, or mutation site. Spec guidance requires refactor preservation ACs to cite pinning tests, and guard-inversion obligations to identify what fails when the guard is bypassed.

**Required outcome:** The AC must name `collapsed table shows one top-level row for a multi-run workflow` (and/or other named tests in `tui-monitor-workflow-collapse.test.ts` if cited) as the positive anchor. It must define “bypass” as **disabling full collapse grouping** on the real path—equivalent to the deleted flag’s effect: every shared-invocation constituent appears as its own top-level rendered row (N rows for N members)—not a partial break such as dedup-only that yields a different symptom. The mutation target should be identifiable (e.g., the `seenInvocations` dedup + `workflow-collapsed` emit block in `buildWorkflowTableRows`, or restoring the deleted early-return’s no-collapse semantics without reintroducing a test hook).

---

## 3. Mark guard-inversion verification as human-only when using the comment-checkpoint pattern

If inversion is proven via source mutation documented in a comment (repo convention for cases like `daemon-workflow-start.test.ts`), that verification is not automatable in CI and is not agent-tickable without running the mutation. An implement agent could otherwise tick the AC without performing the checkpoint, or attempt to automate what the repo treats as operator verification.

**Required outcome:** The guard-inversion AC must carry `(Manual)`, `no automated guard`, or equivalent human-only marker per spec guidance. Automated ACs must remain limited to what an implement agent can verify in the worktree without network access.

---

## 4. Restate the deleted invert test’s negative observable

Decisions say to replace `inverted collapse shows every constituent run as a top-level row`, but no AC records what carries that contract forward. Reviewers cannot diff before/after test intent from the spec alone.

**Required outcome:** The AC or decisions must state that the invert test is **removed** and its negative contract—N top-level rendered rows for N shared-invocation members when collapse is bypassed—is carried by the named positive test turning red under source mutation (and/or documented in the comment checkpoint). Do not require a dedicated invert `test()` or production bypass branch.

---

## 5. Pin verification to rendered monitor text

The task allows “view-model and/or rendered monitor text.” All tests in `tui-monitor-workflow-collapse.test.ts` assert rendered `monitorTextLines` via `tableBodyLines`; the parent collapse spec required rendered output, not view-model-only checks.

**Required outcome:** Drop view-model ambiguity; require rendered monitor text assertions consistent with the existing test file.

---

## 6. Close minor structural gaps (non-blocking individually, required for completeness)

- **Structural AC:** Explicitly require removal of `invertWorkflowCollapseForTest` (module variable), not only `setInvertWorkflowCollapseForTest` and the early-return branch. Optionally assert no replacement production test hooks.
- **Preservation AC:** Citing `collapsed table shows one top-level row for a multi-run workflow` is sufficient; broadening to all collapse tests is optional, not required.
- **Documentation:** “None” is defensible (operator-visible behavior unchanged). Optionally note explicitly that `v1-behaviors.md` is out of scope because there is no operator-visible delta.

---

## Rationale

These refinements close a verification gap the current spec inherits from the very bug it fixes: the invert criterion was satisfiable without the real collapse guard. Intent demands the opposite—proof on the production path via guard mutation, not a toggleable hook. Spec guidance requires agent-verifiable ACs (or explicit human-only markers), named test anchors for refactor preservation, and precise guard-inversion contracts. None of this changes scope or requires a subspec split; one atomic harness slice remains appropriate once the AC wording is tightened.

## Not required

- Subspec split
- New integration tests beyond `test:v2`
- `v1-behaviors.md` updates (unless optional clarification is desired)
- Separate AC for `afterEach` reset removal (moot once the global is deleted)