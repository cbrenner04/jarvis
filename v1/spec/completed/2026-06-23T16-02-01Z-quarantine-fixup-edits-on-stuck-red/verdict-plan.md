## Verdict

The spec is sound in its core design — discard fix-up commits at both exit-10 stuck-red sites and force-push, leaving the PR at the pre-fix-up baseline. But seven points require refinement before it's actuator-ready. All are upheld except where noted.

### Required refinements

1. **Fix the soundness rationale (precision, not design change).** The current decision justifies discard with "both stop conditions guarantee no acceptance-criteria progress … during the fix-up iterations." That is the wrong guarantee and invites a reviewer to disprove it. The real, stronger guarantee is structural: fix-up iterations run with no active linked subspec, so they **cannot commit an AC tick or re-tick** — the only commits they produce are the discardable chase edits (blocker commits exit 7, not 10, and stuck-red requires no new blocker). Rewrite the soundness decision to cite this mechanism (fix-up iterations cannot tick/commit wanted work) rather than a "no progress in last N iterations" argument. This closes the apparent hole rather than asserting around it.

2. **Decide the fate of the discarded tip (evidence preservation).** A `git reset --hard` removes the chase edits from the worktree, yet the operator is sent to finalize/triage by hand to judge "flaky vs real" — with nothing said about how to see what was attempted. The spec must make a conscious, recorded choice: either preserve the discarded tip in a recoverable, named form (tag/branch, or a message line naming where to recover it) so the operator can inspect the chase edits, or explicitly rule that out with a stated rationale (e.g., reflog suffices). As drafted this is an unstated gap that contradicts the "finalize by hand" framing.

3. **Pin order-of-operations and cover the failure paths.** The spec promises exit 10 + `ready-stuck-red` telemetry is unchanged, but a thrown `git reset` or failed force-push could short-circuit that. Specify the sequence (reset → force-push → message → telemetry → return 10) and define behavior when each git step fails: a failed reset and a failed force-push must still write telemetry and exit 10 (or define a distinct, documented outcome). Add acceptance criteria covering at least the failed-force-push-still-exits-10 case; today only a decision mentions it, no AC pins it.

4. **Rename the baseline and pin its capture point.** "Green-completion baseline" is a misnomer — on a stuck-red run the gate never goes green and no green-path result sha is recorded, so an implementer could hunt for a value this run never produces. Rename (e.g., "first-red baseline") and state the capture precisely: HEAD at the first red completion gate, captured before the first fix-up loopback, guarded by git-enabled + repo present — the same guards the existing green path uses.

5. **Name the PR-less / push seam.** This is a harness subspec, so naming the seam is appropriate and makes the last AC testable. The discard path should reuse the existing fix-up push seam (upstream-existence check + the gh-check skip flag) and say so, otherwise the "no PR/remote branch → skip force-push, no error" case cannot be pinned in tests.

6. **Name the force-push command; drop the hedge.** Replace "lease-style where available" with the concrete `git push --force-with-lease` (valid here since the local reset leaves the remote-tracking ref intact), or define the fallback explicitly. "Where available" is unverifiable.

7. **Name the baseline state field.** Naming the run-state field that holds the baseline sha (parallel to the existing consecutive-red and completion-transition state) makes its "captured once, on first red, never overwritten" lifecycle reviewable and ties directly to refinement 1.

### Rationale

These are precision and coverage gaps, not design flaws. Refinements 2 and 3 are genuine behavioral gaps the intent implies but the spec leaves unstated (operator-facing recovery; the promised exit/telemetry invariants under git failure). Refinement 1 corrects a justification that, as written, is falsifiable and would not survive review. Refinements 4–7 are the harness-spec precision the guidance expects — naming seams, state, and commands when structure is the contract — and remove ambiguity that would otherwise force the implementer to guess. No finding warrants reopening the design or the exit-10/telemetry contract.