Verifying advocate claims against the implementation before issuing the verdict.
## Adjudicator verdict — commit-each-write-iteration

### Required outcomes

1. **Terminal completion SHA policy on every terminal committer path**  
   Subspec 01 and `write-behavior.md` require a **distinct** terminal completion commit when the worktree is clean and `HEAD` already qualifies as a Jarvis iteration commit (`forceDistinctCommit` / equivalent). That policy must hold not only on the in-loop `complete` path but also on **publish-resume** (re-entering a run already settled `complete` in SQLite with git publication unfinished) and on **post–ready-gate repair** re-commit before republication. Today those paths call the committer without the distinct-commit bypass, so they can reuse the last iteration SHA and break publish-resume and multi-SHA attribution.  
   **Must be true:** all terminal publication-boundary committer invocations obey the same distinct-completion-SHA rule; add regression coverage for at least publish-resume (and ideally ready-repair re-commit) after one or more iteration commits on a clean tree.

2. **`iteration_commit_failed` operator contract matches implementation**  
   Subspec 00 marks failure as resumable and points operator recovery at subspec 01; `write-behavior.md` calls the outcome resumable. The loop sets `runStatus: failed`, logs `resumable: true`, but daemon/CLI operator-error mapping does not treat `iteration_commit_failed` like `completion_commit_failed`, so `jarvis run resume` and list/wait guidance do not offer a retry path despite the docs.  
   **Must be true:** either (a) wire `iteration_commit_failed` through the same resumable surfaces as other retryable git failures (`run-operator-error`, list/wait, runbook, resume behavior, exit-code tables in `write-behavior.md`), including what the operator does when the attempt never reached `boundary_committed`, **or** (b) remove “resumable” from durable docs/spec-aligned prose and document the actual recovery path (e.g. re-dispatch on same branch via in-progress attempt). Subspec intent favors (a).

3. **Durable docs supersede stale single-commit and kill narratives (subspec 01 doc tasks)**  
   `write-behavior.md` was updated for per-iteration commits but exit/wait sections still center `completion_commit_failed` without `iteration_commit_failed`. `workflow-runner.md` still describes shrink folding into a **single** completion commit. `v2-architecture.md` still implies killed runs leave only uncommitted work, without committed iteration SHAs on the same branch.  
   **Must be true:** align these durable homes with the multi-commit + terminal-completion model and the runbook’s same-branch vs implement re-run reset story; no follow-up deferral for items explicitly assigned in subspec 01.

4. **Checked acceptance criteria for guard-inversion tests**  
   Subspecs 00 and 01 have **checked** ACs that require tests which **fail** if materialization or terminal dirty guards are inverted (no-diff → extra commit; dirty terminal → `complete`). The branch only asserts forward behavior (no-diff count unchanged; dirty terminal via mocking terminal no-op, not inverting dirty detection).  
   **Must be true:** add the specified guard-inversion regressions (or equivalent tests that demonstrably fail when the guard is flipped), so checked ACs match the test suite. Forward-only tests alone do not satisfy the written ACs.

### Not required for actuator (acknowledged, no block)

- Missing dedicated tests for `expectedArtifactPath` fallback, binding `title`, and `publishCompletion === false` (not in subspec ACs).  
- `completionCommitError` field reuse on iteration failures (pre-existing pattern).  
- `committedResult` / store-only outcome mapping for `iteration_commit_failed` (low tooling risk if resume wiring is fixed).  
- Pre-settle abort doc nuance and shared pending-file exposure (inherited committer semantics per subspec 00).  
- Unchecked `intent.md` checklist items (process only).

### Rationale

Subspecs 00–01 are marked complete with checked ACs and doc tasks. Gaps (1)–(3) break the **terminal SHA** and **operator recovery** contracts the spec explicitly decided; (4) breaks **honesty between checked ACs and tests**. Core `progress` hook order, fail-closed iteration commit, multi-iteration happy path, terminal `complete` with `forceDistinctCommit`, attribution, and primary runbook/`v1-behaviors` updates are in good shape and do not remove the need to close (1)–(4) before treating the patch as fully landed.