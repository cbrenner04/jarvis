I'll verify the key claims against the actual code before issuing my verdict, since both the adversary and advocate make heavy line-reference claims that determine whether findings are valid.The core claims are verified. Let me check the remaining return points (review phase, boundary path) and the no-commit handoff wording to fully assess finding #2's enumeration concern and #6's boundary distinction.I have verified all load-bearing claims. The facts are confirmed: `cleanupNoCommitTempSpec` has exactly one call site (814, write-failure catch), every later-phase return exits without it, the boundary path appends a blocker to `intent.md` even in no-commit mode (954), and the `Intent:` line prints once at the top (823) while the success handoff (1192-1197) has no failure-path analog. I'll now check `v2/docs/v1-behaviors.md` line refs to verify findings #8.All findings verified against the code. Lines 74-76 of `v1-behaviors.md` confirm finding #8: line 75 already documents the `Intent:` print and operator-retention-on-failure, line 76 already documents no-commit boundary behavior. The spec's new bullet must extend, not restate. I have enough to issue the verdict.

---

# Verdict — Refinements Required (First Pass)

The spec is well-grounded, honestly reconciled against current code, and correctly scoped as one reviewable change. No finding undermines its design or scope. The required refinements are clarity, acceptance-criteria enumeration, and pinning one unspecified mechanism. Address the following.

## 1. Enumerate the exact failure-return set the breadcrumb AC covers (top priority)

The acceptance criterion for failure-output breadcrumb is universally quantified ("on a later-phase failure where cleanup is skipped"), but the no-commit path has many distinct return points: draft generic-error, draft quota, draft model-config, draft validation failure, draft-catch, boundary violation, draft blocker, review generic-error/blocker, review quota, review model-config, and interrupt (`return 130`). The task body says "each later-phase failure," but the criterion's phrasing lets an implementer emit the breadcrumb at one path and a reviewer cannot tell whether the criterion is satisfied.

**Required outcome:** The spec must name the concrete set of `commit: false` failure exits where the preserved-directory line must appear, and reconcile that set with the intent's desired-behavior list — which explicitly names refine, draft, review, validation, quota, model-config, interrupt, and generic errors. State whether the interrupt path (`130`) and quota path (`2`) are in scope for the breadcrumb. This is the single highest-value fix because the criterion is otherwise under-verifiable.

## 2. Pin the cleanup-helper hardening mechanism

The task says to "constrain `cleanupNoCommitTempSpec` so it cannot delete a finalized dir," but that helper already has exactly one call site — the `intent.md` write-failure catch, which fires before the operator-visible `Intent:` line is printed. "Constrain" therefore has no concrete target: the only call site is already safe. Leaving a required hardening mechanism unspecified is exactly the warning sign the intent's discipline cautions against.

**Required outcome:** The spec must name the actual code change that hardens this path — e.g., renaming the helper to reflect "abandoned pre-intent directory" rather than the misleading "TempSpec," adding a guard that the breadcrumb has not yet fired, or another concrete mechanism — and must decide in-scope vs. out-of-scope for removing the dead `tmp-` prefix constant it flagged. If that constant removal is in scope, make it a task deliverable; if not, drop the mention so the spec does not flag dead code it then leaves untouched.

## 3. Label each acceptance criterion as regression-guard vs. code-delta

Several acceptance criteria describe behavior that already holds today (the finalized directory survives later-phase failures only incidentally, because those return points happen not to call cleanup). The spec's reconciliation section is honest that this is "incidental," but the criteria themselves do not distinguish which are guard-rail tests over existing behavior and which require a genuine code change (the breadcrumb output and the helper hardening).

**Required outcome:** The spec must make explicit, per criterion, which are regression tests pinning existing-but-incidental behavior and which require new code. This prevents an implementer from believing all criteria need new code, or from skipping the guard-rail tests as redundant. Pinning incidental behavior with a test is legitimate and valuable; the spec must say so plainly.

## 4. Specify the write-failure test injection technique

One acceptance criterion requires a test where `intent.md` write fails before any phase runs, leaving the abandoned external directory removed. Forcing this is non-trivial: the directory `mkdir` succeeds while only the file write throws. The existing test in the named test file fails via a bad agent, which is a much later failure point and does not exercise this path.

**Required outcome:** The spec must name a deterministic injection strategy for the pre-phase write failure (for example, pre-creating a directory at the `intent.md` path so the file write throws `EISDIR` while the directory creation succeeds). If a forced-throw test proves too brittle, the spec must say the criterion may instead be satisfied by asserting the single existing call site's behavior. As written, the criterion asserts coverability with zero strategy.

## 5. Resolve the post-draft phase under-specification and boundary distinction

One acceptance criterion says "review (or other post-draft) phase," but the no-commit boundary-violation path behaves differently from a plain review failure: it appends a blocker to `intent.md` while preserving the directory, whereas review failure preserves without modifying. The decisions list names "boundary" among preserved-on-failure paths, but the criterion only says "review (or other)."

**Required outcome:** The spec must pick one concrete phase for that criterion and stop saying "or other post-draft," and must decide whether boundary-failure preservation gets its own tested criterion or is covered by the enumeration in refinement #1. Resolving #1 largely subsumes this, but the boundary path's distinct intent-mutating behavior should be acknowledged.

## 6. State the breadcrumb's rationale explicitly

The spec introduces a new failure-output line naming the preserved directory, but a near-equivalent `Intent: <path>/intent.md` line is already printed for every no-commit run, near the top, before any phase. The spec asserts the new line is needed without arguing why.

**Required outcome:** The spec must state the load-bearing distinction: the new line is emitted adjacent to the error (after agent transcript output has scrolled the early `Intent:` line away) and names the directory the operator must inspect, not just the file inside it. This justifies why a reasonable implementer should not drop the new line as redundant with the existing one. The intent's decision rules out "relying only on prior stdout breadcrumbs," so the rationale must be on the page, not implied.

## 7. Scope the documentation deltas to avoid restating existing prose

The two documentation targets already cover adjacent ground:

- The v1-behaviors catalog already documents the `Intent:` print and operator-retention-on-failure, and already documents no-commit boundary behavior. The new bullet must **extend** those entries with the directory-preservation guarantee and the failure-path breadcrumb, not restate them.
- The plan-mode external-spec cleanup/troubleshooting section already tells operators where external specs live and that cleanup does not touch them, but only frames successful runs. The genuinely missing content is the **failure** case.

**Required outcome:** The spec must scope its doc edits to the failure-path additions and direct the implementer at the existing entries to extend, so correct prose is not churned or duplicated.

## 8. Make the committed-mode invariant verifiable or demote it

One acceptance criterion states committed (`commit: true`) cleanup behavior is unchanged. As a negative invariant it is not falsifiable as written.

**Required outcome:** Either cite an existing committed-mode cleanup test that must continue passing, or demote this to a non-criterion scope note. It should not remain a speculatively tickable criterion with no verification anchor.

---

**Not required:** No restructuring, no split, no scope change. The line references in the spec are accurate today and are acceptable as advisory anchors; the spec need only note they are advisory if it wishes. The design (preserve finalized directory, limit auto-cleanup to the abandoned pre-intent case, add a failure breadcrumb, leave committed mode untouched) is sound and stays one reviewable change.