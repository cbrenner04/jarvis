## Verdict — refine before implementation

### 1. Fixture must exercise the new guard, not the existing fence
The frozen repair allowset is derived without untracked inventory, so a sidecar that merely appears in the worktree during the repair edit is already rejected today. A regression built that way would pass pre-fix for the wrong reason and prove nothing about the sidecar rule.

Required: the failing-test AC must pin that the sidecar is an *allowset member* — present before the allowset freeze (committed in the run diff, or under the resolved spec tree) — so the only thing rejecting it is the `.jarvis-*` basename rule. Without this, the "fails against the pre-fix baseline" criterion is not honest.

### 2. Rejection predicate and tree assertion must use the same, stated semantics
The decisions say "basename matches `.jarvis-*`" but the AC says "excludes every `.jarvis-*` path," which reads as a full-path glob. Required: state the predicate once (basename-scoped) and use it for both rejection and the tree assertion, and state what "published tree" means concretely (paths introduced by repair-completion commits on the branch), matching how the existing fence tests assert non-publication (`completion_commit_failed` plus no second publish). Note explicitly that nested files under a `.jarvis-*` directory whose own basenames are ordinary (e.g. `.jarvis-plan-stage/intent.md`) are out of scope.

### 3. Failure evidence must not misdescribe the violation
The motivating case is a sidecar that *is* inside the frozen allowset, so reusing the existing "outside run diff and spec tree" fence message would tell the operator something false. Required: a decision recording either a distinct failure message for basename rejection, or an explicit accepted tradeoff that the named path alone is sufficient evidence. Silence here is the gap.

### 4. Ordering between basename and allowset violations must be determined
"Before or alongside allowset membership" leaves the observable first-offender behavior open, which conflicts with the existing fence's deterministic first-offender contract. Required: pin the order (basename check first, deterministic among multiple sidecars) so a candidate set containing both violation types produces a stable, correct failure.

### 5. Guard-inversion AC must name a seam that exists
The current test-inversion seam bypasses the *entire* repair fence, not the basename rule specifically. As written, "inverting the `.jarvis-*` basename guard" either overclaims or silently mandates a new surgical seam. Required: pick one — reword the AC to the existing whole-fence inversion seam, or require a basename-scoped inversion seam as work — and make the choice explicit.

### 6. Record the same-seam serial dependency
Two sibling intents in the queue extend the same repair-completion validation seam. Spec guidance requires same-seam siblings be planned and implemented serially; parallel work stales the siblings. Required: a note in the spec recording that this spec lands before those siblings are planned/run.

### Explicitly not required
- Primary completion (`git add -A`) remains unfenced — inherited scope boundary from the prior fence spec; no new AC.
- Recovery/retry/review-mutation routes inherit the shared validator; no duplicate ACs, though a Work bullet noting the inheritance is intentional would be useful.
- Broad `.jarvis-*` matching rather than a hardcoded verdict-file list is correct and should stay.
- The subspec carrying a `v1-behaviors.md` update the intent omits is correct per spec guidance; no change.