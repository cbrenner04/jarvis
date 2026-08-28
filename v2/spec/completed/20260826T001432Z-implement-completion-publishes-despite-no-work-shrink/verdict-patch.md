## Verdict — changes required

The content-vs-base gate and the commit-attribution fallback are the right predicates; the ledger's reasoning for both holds. The defects are in failure semantics, rollback correctness, observability, and two ticked criteria that overstate what the tests prove. Fix these:

### 1. One coherent rule for "the gate could not be evaluated"
Today the two new git reads resolve failure in opposite directions: an unreadable/unresolvable **base** yields `0` → publication suppressed, while an unreadable **commit** or a non-`.git` worktree yields `1` → publication proceeds. Required outcome: suppression happens **only when the diff was positively read and came back empty**; every state where the gate cannot be evaluated preserves the pre-change always-publish behavior. Stating it that way makes the `commitExists` probe unnecessary — and that probe exists solely to keep two stubbed-committer tests (returning the non-existent `"commit-1"`) working, which is production code shaped around a test double, against the subspec's "no test-only inversion hooks". Remove it; the unified rule covers the same case. This is a deliberate deviation from the ledger line "a failed or unparseable diff read resolves to *no publishable content*" — it serves that line's own stated rationale ("rules out a diagnostic git read that can strand a completed spec") better than the literal wording, so record the deviation in the durable doc rather than leaving it implicit.

### 2. Suppression must leave the worktree and branch in an honest state
`filesChangedFromBase === 0` means *commit tree equals base tree*, not *commit equals its parent*. Two shapes are wrong today:
- A boundary that legitimately reverts branch content back to base produces a real commit with real changes relative to its parent; `git reset --mixed` then dumps those changes into the working tree and the run still returns `complete` over a dirty worktree.
- On the committer's pending-retry path the returned `commitSha` **is** the HEAD sampled before the call, so the reset is a no-op and a content-empty commit stays on the branch, unpushed and unrecorded — precisely the dangling commit the ledger rules out.

Required outcome: after a suppressed publication, the working tree is no dirtier than the committer found it, and no content-empty completion commit is left sitting on the branch (including the pending-retry shape where HEAD already is that commit). Where the tail's commit carries real changes against its parent, keep the commit rather than unwinding it into the working tree. Also harden the rollback subprocess so a failed rollback still means "don't publish" instead of throwing out of a completed run. Cover the revert-to-base shape with a test.

### 3. Suppression must be visible
The new non-publishing path emits nothing — no trace record, no `stopReason`, no log line — while every other exit from this tail records one. A run that reports `complete` with no PR and no explanation is the exact operator experience this spec exists to remove. Required outcome: the suppression path appends a durable completion-publication record naming why nothing was published.

### 4. Subspec 01 AC #4 is not true as ticked
`readBranchCommits` maps an empty trailer field to an empty array, so the untrailered fixture's `.find(...)` returns `undefined` under both the original and the mutated predicate — the named test `a branch whose commits carry no Jarvis-Agent trailer resolves no publishing identity` does **not** go red under its own carried mutation. (The checkpoint gate is still honest overall: the verifier runs the scoped suite and the sibling attributed test does catch it.) Required outcome: the named test actually detects the mutation it carries — e.g. give the fixture a commit whose trailer list contains an empty value ahead of a real one — or relocate the directive to the test that genuinely pins it, so the ticked criterion matches reality.

Lower priority, record accuracy: the keystone directive carried in `unattributed completion boundary publishes under the branch commit attribution` is semantically equivalent to, but textually different from, the literal string the criterion names (the formatter split that ternary across lines). Make the two agree where formatting allows; no behavior impact.

### 5. Documentation must cover the failure directions and the pipeline consequence
Subspec 00's doc criteria are already ticked, so the durable homes are open and must be brought in line with the final behavior:
- `v2/docs/workflow-runner.md` — record not just the happy path but what an unevaluable diff/base/commit does (per outcome 1) and what suppression does to the local commit and working tree (per outcome 2). Both are operator-visible.
- `v2/docs/operator-runbook.md` — name the pipeline consequence: a stage with nothing ahead of base now yields no draft PR, so terminal publication fails fast on missing PR evidence instead of ready-flipping an empty PR. That is the spec's own accepted trade ("a run with no commits against a clean worktree neither pushes nor opens a PR"), but the operator needs the failure-to-cause mapping.

### Not upheld
- The `existsSync(join(path, ".git"))` guard before reading HEAD is the established idiom in this file and covers real non-worktree shapes; keep it.
- Reading `baseRef` as a ref resolvable inside the worktree is pre-existing behavior (`changedFiles`, `readBranchCommits`, and `gh pr create --base` all do it). The `baseRef: "HEAD"` fixture rewrites are test hygiene, not evidence of a production regression; validating operator-supplied `--base` is a separate concern.
- Reusing the existing `gitOutput` helper for the diff is not an improvement: it returns `""` on failure, conflating "no diff" with "couldn't read" — the exact ambiguity outcome 1 removes. A dedicated read with an explicit unevaluable signal is correct; consider naming it for its tri-state meaning rather than as a count.