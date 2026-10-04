# Adjudicator verdict — `reset-stale-workspace-refuse-dirty-worktree`

## Required refinements

1. **Split the observability contract (`reason` vs stderr)**  
   The spec must state that `resetStaleWorkspace` refuses with `{ status: "refused", reason }` and does not own stderr (consistent with live-held and open-PR refusals). Direct seam tests and `cleanup.test.ts` acceptance must assert **`reason`** (dirty paths + recovery), not stderr. Workflow re-run acceptance must assert **operator-visible stderr** via the existing `Cannot re-run incomplete spec: …` wrapper. Task checklist and cleanup ACs that say “stderr names paths” must be aligned so implementers do not add stderr writes on the cleanup seam or assert the wrong surface in unit tests.

2. **Pin dirty-detection policy for a safety gate**  
   The spec must define what “dirty” means in testable terms: uncommitted tracked changes and untracked paths as reported by the chosen git status/porcelain mode (including whether untracked-under-directories are in scope, e.g. `--untracked-files=all` if that matches other harness dirty gates). It must require **fail-closed** behavior when dirty state cannot be listed (refuse with a clear reason, no `performAbandonmentSteps`)—explicitly **not** reusing fail-soft “return empty and continue” helpers that could allow teardown. Ignored-only untracked may stay as default porcelain semantics unless intent is expanded; submodule/conflict cases should defer to “non-empty porcelain = dirty” unless narrowed.

3. **Fix the abandon preservation acceptance criterion**  
   Replace the current wording that implies “abandon test stays green **with a dirty worktree present**” (new behavior bundled into a preservation cite). Either: (a) cite-only preservation—that named abandon test **stays green** with no new dirty setup—or (b) add a **separate** behavioral AC with a failing-test requirement that `jarvis cleanup --abandon` still retires when the worktree is dirty. Intent already limits the new gate to implicit `resetStaleWorkspace`; preservation must not read like abandon gained a dirty check.

4. **Keep guard-inversion; clarify how it is satisfied**  
   Retain the AC that retirement still occurs on an otherwise eligible stale workspace when the dirty guard is negated. The spec should state that inversion is proven via an **extracted dirty check** (or another documented test seam), not only by “dirty refuses” tests—so refusal tests cannot pass with a no-op guard. Mechanism remains implementer choice; dropping or weakening the AC is not acceptable per spec guidance on guard suppression.

5. **Documentation coverage for plan, not only implement**  
   Documentation tasks must make incomplete **plan** re-run refusal and recovery visible to operators (commit, discard, `jarvis cleanup --abandon <branch>`, no override in this slice)—not only under Implement workflow / Recovery. Cross-reference pre-mutation refusal behavior for daemon/re-run where the runbook already documents that class.

6. **Optional but worthwhile: refusal taxonomy**  
   Decisions or recovery copy should include a stable, distinguishable lead-in in `reason` (parallel to other pre-mutation refusals) so runbook and stderr remain scannable; path dumps alone are insufficient (already in decisions—ensure AC/tasks do not contradict “recovery guidance required”).

## Rationale (brief)

Intent and seam choice (gate order, pre-mutation, shared `resetStaleWorkspace`, `--abandon` unchanged, one workflow regression for implement) are sound and need no rethink. The draft leaves implementers exposed on **which string is the contract at which layer**, **what happens when git listing fails**, and **what the abandon AC actually preserves**—all of which affect safety and spec-guidance compliance (behavioral ACs, preservation cites, failing-test + inversion for new guards). Addressing the six items above closes those gaps without expanding scope beyond the intent.

## Not required

- Duplicate plan workflow regression AC (shared seam + implement workflow test remains sufficient if dirty policy and `reason`/stderr split are clear).  
- Mandatory policy for ignored untracked, path sort/truncation, or machine-parseable `reason` beyond naming paths and recovery (defer unless product asks).