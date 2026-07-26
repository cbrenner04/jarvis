## Verdict — refinements required

**1. Decide how a committed iteration is distinguished from a skipped one (blocking).**
The completion committer's result cannot be used as-is to tell "I made a commit" from "nothing changed." Once any iteration commit exists on the branch, HEAD carries a `Jarvis-Agent:` trailer, so a later no-change iteration takes the reuse path and returns a real `commitSha` — HEAD, which that call did not create (`v2/src/execution/completion-commit.ts:75-85`). As drafted, the acceptance criterion requiring commit/no-change/no-`.git` to be "distinguishable" in the log is unimplementable, and the Decisions line presenting the committer no-op as unconditional overstates it. The spec must take a position on a created-vs-reused discriminator (a result-level signal, or observing HEAD around the call) and carry an acceptance criterion that a no-change iteration following a committing iteration reports *skipped*, not a SHA.

**2. Name what iteration commits do to the shrink reset (blocking).**
The implement step's pre-shrink committer call (`v2/src/execution/workflow-runner.ts:670-681`) records a SHA that publication later unwinds with `reset --mixed <sha>^` (`:849-855`). Today that call always creates a fresh commit, so `<sha>^` is pre-implement HEAD. With per-iteration commits and a clean tree at implement completion — the common case, since the last iteration already captured the work — that call reuses HEAD and the reset unwinds the *last iteration commit* instead. Content survives (the forced publication commit recommits the worktree), but shrink's base and the iteration-SHA history the intent promises do not. The spec must decide this explicitly and pin it with an acceptance criterion. The same created-vs-reused signal from refinement 1 resolves it.

**3. Scope which workflow steps get per-iteration commits, or state the plan/intent consequence.**
The change is written against implement runs, but the suppressing assignment is unconditional across every workflow step, including git-backed plan/intent steps whose staging artifacts (`INTENT_STAGE`) the landing step later removes. Those runs will now commit staging directories mid-flight. Either scope the change by step behavior/role, or state plainly that staging artifacts are committed in-flight and cleaned by landing — with an acceptance criterion exercising a plan/intent workflow either way. An unenumerated behavior change to every plan and intent run is exactly what `v2/docs/v1-behaviors.md` exists to prevent going unrecorded.

**4. Tie the `.git` guard to the real case that needs it.**
No-commit intent steps run with `worktree.git: false` — that is why the guard is load-bearing, and the spec should say so. The guard-inversion criterion should exercise a `git: false` workflow step rather than a generic non-git worktree.

**5. Close the mocked-committer loophole in the mid-run-failure criterion.**
`workflow-runner.test.ts` injects `completionCommitter`, so "drives that path against a git fixture" can be satisfied without a real repository. The criterion must require the assertion be made against real git history (`git log <base>..HEAD` on a real fixture), not an injected double. Real-git fixtures already exist in the repo to model on.

**6. Say what the log reports when the iteration commit throws.**
The event is specified only on the success/skip paths, but a commit failure is the case an operator most needs surfaced. Either emit the event on the failure path too, or state in Decisions which existing signal (`loop_finished{iteration_commit_failed}`) covers it.

**7. Take a one-line position on newly-reachable commit failures.**
A committer error during a `progress` iteration can now hard-fail a workflow step mid-run where it previously could not. The existing failure result is resumable and the step re-dispatches, so the behavior is likely already correct — but the spec should say so rather than leave it unexamined. No separate acceptance criterion needed.

**Not upheld** — no change required: the "no duplicate or orphaned commits" decision (the terminal committer is already skipped for `publishCompletion: false` steps, and the single forced publication commit per workflow is documented existing design); the overlap between the `.git`-inversion and event-distinguishability criteria (different contracts, and guard-inversion coverage is required by repo rules); the documentation-update wording (it already distinguishes dropping an obsolete precondition from correcting an error).