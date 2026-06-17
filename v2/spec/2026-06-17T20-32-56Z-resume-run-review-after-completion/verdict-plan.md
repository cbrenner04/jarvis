I'll ground this verdict in the actual codebase before adjudicating. Let me verify the load-bearing claims about `ensureWorktree`, the completion path, the review phase, and exit codes.Let me read the key sections directly.The core claims are confirmed. Let me verify the review baseline gate and the `gh pr ready` final-gate behavior to ground findings #5 and #6.All load-bearing claims are confirmed in code. The preflight order is: `assertGhReady` (332) → `ensureWorktree` (346, auto-creates) → spec prep → `maybeWarnAboutUnmergedPlanBranch` (412). `ensureWorktree` never errors on absence; it manufactures a branch+worktree off base (worktree.ts:48-58). The completion path (`tryFinishSpecIfDone`) is only entered when `before === 0` (run.ts:735); unchecked tasks route to an implementation agent. Review/shrink are both gated on `implementationIterations > 0` (run.ts:1353-1354). Baseline gate returns non-zero on failure (review.ts:570-582); final gate runs `gh pr ready` and is unaddressed for retry-after-ready.

I have enough to adjudicate. Here is the verdict.

---

# Verdict — resume-run-review-after-completion (Pass 1)

The spec's intent, decision ledger, and 00/01 split are sound. The defects are concentrated in the guard mechanics of subspec 00 and the boundary between 00 and 01. The following refinements are **required** before this spec proceeds.

## Required refinements

**1. Resolve the "no PR/worktree" guard against worktree auto-creation.**
The existing run resolution path does not detect a missing worktree — it manufactures one. When no local/remote branch and no worktree dir exist, the resolver creates a fresh branch off the base branch and a new worktree, then continues. It is invoked early in preflight, before any point where the spec's guard could fire. Therefore "reuse the existing resolution path with no parallel resolver" and "reject when no implementation PR/worktree exists" are mutually incompatible as written. The spec must pin **how absence is detected** (an existence probe — remote-branch and/or PR presence — that runs *before* the worktree-materialization step) and must explicitly carve that probe out as the one sanctioned exception to "no parallel resolver." Without this, the guard is unimplementable and the resume could silently fabricate a fresh worktree off base — the opposite of "preserve existing PR/worktree semantics."

**2. Split the conflated PR-vs-worktree guard; treat a missing local worktree as recoverable.**
PR existence and local-worktree existence are independent states. A previously completed spec normally still has its PR, but its local worktree is routinely gone (e.g., after cleanup, or on another machine), and the resolver can legitimately recreate the worktree from the remote branch. The review-to-ready path requires a **PR** (it runs `gh pr ready` against one); it does not require a pre-existing *local* worktree. The spec must:
- make **missing PR** (equivalently, no remote branch to back one) the hard error, and
- allow a missing-but-recreatable worktree rather than rejecting it (or, if the operator contract is deliberately "only resume an in-place worktree," state that explicitly and justify it).

The acceptance criterion "naming the missing PR/worktree" must be split so each condition has a distinct message and it is unambiguous which fired.

**3. Move the unchecked-tasks rejection into subspec 00's preflight.**
A spec with remaining unchecked tasks never reaches the completion path that 01 names; it routes to an implementation agent before that point. So the assertion "review-resume runs no implementation agent on an incomplete spec" cannot be enforced inside 01's execution path — it must be a **preflight guard that runs before the implementation loop**. That makes it a guard, which belongs in subspec 00 alongside the other guards. It is currently misplaced in 01 and double-specified across both files. Consolidate all four guard conditions (review disabled, git off, no PR, unchecked tasks) in subspec 00, and remove the duplicate framing from 01. This also restores atomicity: 00 owns all guards, 01 owns execution.

**4. Assign and document exit codes for the guards.**
The spec says "non-zero exit" four times but pins no code, and the authoritative exit-code table is the documentation contract. Map each guard failure to a concrete code (the existing "bad input / unsupported invocation" code is the natural fit, consistent with how comparable invalid-invocation preflights already exit) and record the mappings in the run-loop exit-code table, not only in narrative prose.

**5. Pin `--max-iterations` instead of deferring-and-defaulting.**
Subspec 00 simultaneously defers the `--resume-review` + `--max-iterations` interaction "to first consumer" and states a default behavior in the same sentence. That violates the intent's own rule against inventing precision while claiming to defer, and the flag is parsed unconditionally today, so "ignore it" is itself a real parse/runtime decision. Since review resume runs zero implementation iterations, pick one flat outcome (e.g., "`--max-iterations` is accepted but inert under `--resume-review`," or a clean deferral with no parenthetical default) — not both.

**6. Specify the iteration-gate bypass predicate and its single live entry point.**
The spec says review resume "bypasses the implementation-iteration gate" but does not pin the predicate change or which completion entry point is involved. Only the completion entry reached at zero iterations is live for a resumed completed spec (the post-iteration entry is unreachable when no implementation iteration runs). The spec must state the predicate change precisely (treat the iteration-count condition as satisfied when review-resume is active, for the review phase only) and name that this applies to the zero-iteration completion entry — while affirming the gate is unchanged for normal runs so ordinary checkbox-only completions still skip review.

**7. Add baseline/final-gate failure to the preserved review outcomes.**
The review phase runs a baseline readiness gate first and returns non-zero on failure; the final gate can likewise fail. Because resume's stated purpose is "run *or retry*," and a resumed worktree is *more* likely to fail the gate (base may have moved, deps drifted), gate failure on retry is a first-class path. Subspec 01 enumerates blocker and quota exits but omits gate failure. Add baseline/final-gate failure (non-zero exit) to the preserved outcomes with a covering acceptance criterion.

**8. Add a retry-after-ready idempotency criterion.**
The final gate runs `gh pr ready` unconditionally, and the marquee use case is retrying review *after* a prior successful run (the PR may already be ready). Subspec 01 asserts "idempotent ready transition" as a decision but never verifies it. Add an acceptance criterion defining the expected outcome of `--resume-review` against an already-ready PR (a clean exit that leaves the ready PR untouched, matching the established idempotent-ready precedent), so the idempotency claim is testable.

**9. State guard ordering relative to the `gh` readiness check.**
The new guards need a defined position in the existing preflight order. The no-PR guard depends on `gh` and must run *after* the existing `gh` readiness assertion; the git-off and review-disabled guards may run earlier. Add one sentence pinning this ordering.

## Findings explicitly rejected (no refinement required)

- **Acceptance criteria being "too structural."** These are harness subspecs, where spec guidance explicitly permits naming telemetry fields and internal symbols when structure is the contract. The shrink-skip criterion phrased via phase telemetry is already compliant; the commit-absence rephrase is an optional nicety, not a defect.
- **Telemetry summary shape for a zero-iteration resume.** A resume that runs review will print a summary with zero implementation iterations and review attempts counted separately; existing aggregation already handles this. At most a one-line doc note in the run-loop review-resume section — not a design change or new criterion.
- **Unmerged-plan-branch warning.** Non-blocking preflight noise; not worth spec text beyond the ordering sentence in refinement #9.

## Note for the refiner
The decision ledgers are strong and should be preserved — each names the wrong alternative it rules out (synthetic unchecked task, plan-resume overload, lowering the gate for normal runs, shrinking unrelated diffs). Keep that discipline when adding the new decisions above; the gaps are in guard mechanics and the 00/01 boundary, not in the rationale or the overall split.