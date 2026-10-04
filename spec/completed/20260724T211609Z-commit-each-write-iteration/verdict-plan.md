# Adjudicator verdict — commit-each-write-iteration

Required refinements before the spec is implementation-ready:

1. **Recovery narrative (intent + subspec 01)**  
   Separate “work survives on the same run branch” (kill, daemon reconcile, resume while the branch still exists) from “implement re-run after incomplete run” (`resetStaleWorkspace` still drops the branch and unpushed SHAs). Intent problem text and operator runbook must not read as if per-iteration commits fix reset/re-run data loss; state what survives in each scenario and that publication-at-completion-only is unchanged.

2. **Terminal completion when HEAD is already a Jarvis iteration commit (subspec 01)**  
   Add an explicit product decision: how terminal `complete` produces a distinct completion SHA for attribution and publish-resume when the worktree is clean and HEAD already has `Jarvis-Agent:` from the last iteration commit (existing HEAD-reuse in the committer). Subspec 01’s AC requiring iteration commits **plus** a terminal completion commit cannot be met without this decision; options are choosing a policy in the spec, not leaving it to implementation.

3. **Timeout path (intent + subspec 00 or 01)**  
   Intent mentions timed-out runs; v2 timeout today only hits SQLite boundaries. Either scope timeout out (with a short v1-behaviors or decisions note) or require the same per-iteration commit behavior when timeout settles with a dirty worktree—one clear in/out scope line.

4. **Kill/abort timing (subspec 00)**  
   Decision to commit before post-settle `signal.aborted` implies in-step kill recovery; the kill AC only covers abort between iterations. Add an acceptance outcome for abort after a settled step with file changes (with guard-inversion), or narrow the decision and runbook to between-iteration kill only and document in-flight step loss.

5. **Unchanged-iteration guard (subspec 00)**  
   Align “no commit when unchanged” with the same materialization rule the committer uses (e.g. isolated index `tree === baseTree`), and tie the negative AC to inverting that guard—not a vague “dirty guard.”

6. **Progress-path commit failure (subspec 00)**  
   State fail-closed vs log-and-continue when iteration commit fails on `progress` (parity with terminal `completion_commit_failed` or an explicit exception).

7. **Iteration message contract vs intent (subspec 00 and/or 01)**  
   Intent asks for iteration + subspec in messages; ACs only assert `Jarvis-Agent:`. Either add verifiable ACs for attribution-required body shape (`Spec:` / subspec path) or narrow intent to “trailer + attribution-compatible body; subject template deferred.”

8. **Binding metadata on progress (subspec 00)**  
   Document how `title`, `agent`, and `specPath` are resolved on progress (including quota fallback, empty agent, plan/draft when `expectedArtifactPath` does not resolve—fallback to run `specPath`).

9. **Task scope in subspec 00**  
   Remove or narrow “any other non-terminal settled outcome” to paths covered by ACs (`progress`, and timeout only if item 3 is in scope). Do not leave `blocked` / `contract_miss` / etc. as open implementation expansion without criteria.

10. **Hook ordering (subspec 00)**  
    Require an explicit outcome: iteration git commit runs after step settle and before SQLite `commitCompletionBoundary` and before post-settle abort short-circuit, for every in-scope non-terminal path—so implementers know where the hook lives relative to `settled.kind === "aborted"`.

11. **Pending-commit / publish-resume interaction (subspec 00 or 01)**  
    One decision line: iteration commits must not leave orphan `jarvis-completion-pending` (or equivalent) that blocks or confuses terminal publish-resume; crash mid-pending behavior aligned with existing completion semantics.

12. **Coverage advisory (subspec 01 or docs)**  
    State whether post-loop advisory edits are only captured at terminal completion (and thus can make the worktree dirty at terminal boundary)—so the dirty-terminal AC and runbook stay honest.

13. **Documentation supersession (subspec 01)**  
    Doc tasks must replace or supersede the single completion-meta-commit story in `write-behavior.md` with the multi-commit + footer model; runbook must match refined recovery boundaries (item 1). Consider `v2-architecture.md` (or explicit follow-up) if it still says killed work is entirely uncommitted.

14. **Attribution AC honesty (subspec 01)**  
    Keep the write-loop multi-commit `renderAttribution` AC, but frame it as validating branch history plus terminal SHA policy (item 2), not only footer math—`pr-attribution` alone may not fail pre-fix.

15. **Out of scope (decisions)**  
    One line: non-git / `publishCompletion === false` write loops are out of scope for per-iteration git recovery.

16. **Subspec split (conditional)**  
    If the terminal SHA policy (item 2) is more than a small committer tweak, split it into a third index-linked subspec with its own testable ACs; redistribute tasks/ACs so nothing from 00/01 is dropped.

**Rationale:** Intent and spec guidance require agent-verifiable, failing-test-backed behavior and honest operator docs. Without items 1–2, acceptance criteria and runbook overpromise recovery and terminal attribution. Without 3–10, implementers will guess on timeout, abort timing, guards, failures, and hook placement. Items 11–14 close doc and edge-case gaps that would otherwise regress publish-resume or dirty-terminal contracts.

**Not required for verdict:** Mandating an extra `refreshPrBody` integration test beyond `renderAttribution` + preserved `pr-body-refresh` AC (optional tightening). Splitting 01 solely for `test:integration:v2` vs 00’s `test:v2` is acceptable if subspecs land in order on one branch.