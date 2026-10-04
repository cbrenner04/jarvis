# Continue a clean, base-descended lane with committed work

Today an incomplete re-dispatch whose lane holds commits ahead of base refuses via `staleResetUnlandedCommitsGateReason` (no open PR yet) or `staleResetLandedCriteriaGateReason` (ticks present, e.g. once a draft PR exists) in `v2/src/commands/cleanup.ts`. Replace both refusals with continuation when the lane is safe to resume. The branch-commit tick check ships in this same subspec, not later — a relaxed gate without it is weaker than today's refusal for even one commit.

## Decisions

- `resetStaleWorkspace` gains a `continue` status (distinct from `reset`/`no-op`/`refused`), returned when: worktree exists, no live owner/claim, clean tree, `HEAD` descended from resolved base, commits ahead of base, and every criterion checked in the worktree but absent from base is backed by a `base..HEAD` commit; rules out overloading `no-op`, which callers already read as "nothing needed reset."
- `continue` reaches both dispatch callers through the existing shared `prepareWorkflowStart` (`v2/src/commands/workflow-start-preparation.ts`), used by `v2/src/commands/workflow.ts` (CLI) and `v2/src/daemon/pipeline-workflow-preparation.ts` (daemon pipeline dispatch); neither caller branches on the reset outcome today (only `onDestroyed` and the exit code matter), so a non-refused `continue` needs no new caller logic — the existing write-step routing already re-resolves the first unchecked, non-human-only link and leaves branch, commits, ticks, and any open draft PR untouched; rules out a continuation-specific router.
- A checked criterion counts as backed by a branch commit when some commit in `base..HEAD` introduces that exact checked line in that subspec file — either as an added line in a new file, or as a change from unchecked to checked; rules out matching on criterion text alone, which a re-added identical line from an unrelated edit would pass without evidence of intent.
- The refusal for an unbacked tick lists the offending subspec path(s) and names its fix (untick the criteria, or `jarvis cleanup --abandon <branch>`).
- `specs: external` trees skip the branch-commit tick check, the same way `isStaleResetLandedCriteriaSpecPath` already skips the landed-criteria drift check outside the project root; continuation for external trees is gated only by the existing live-owner/dirty/descendant checks; rules out inventing a cross-repo provenance check the project's own git history can't answer.
- `--reset-despite-landed-criteria` (`skipLandedCriteriaGate`) forces retirement instead of continuation on an otherwise-continuable lane, so it can never bypass the tick check by continuing on unverified ticks — the flag's purpose is retiring past landed-criteria drift, not resuming.
- Dirty tree and live-owner refusals reuse the existing gates and messages unchanged.
- A lane whose base has moved past its fork point (its `HEAD` is not a descendant of the resolved base but its fork point is an ancestor of it) is rebased onto the resolved base before continuing; a clean rebase continues, a conflicting rebase is aborted (worktree left exactly as before) and refused naming the conflicting paths. Rules out continuation that never applies once `main` moves, which is the common case (operator amendment 2026-09-17). A `HEAD` with no shared history with the base still refuses as today.
- A lane where every non-human-only criterion is already ticked is not this subspec's concern: the existing write-step routing (`workflow-runner.ts`) already finalizes once continuation reaches it, per the pre-existing fresh-dispatch rule.

## Acceptance criteria

- [x] A workflow-command test drives a lane with two committed subspecs (each tick backed by its own commit) and one unchecked subspec, a clean tree, no live owner, and no PR yet, through the CLI dispatch path, and asserts re-dispatch continues on the same worktree and branch at the unchecked subspec with no retirement; it fails against the current unlanded-commits refusal.
- [x] The same lane with an existing open draft PR on the branch asserts continuation leaves the PR open and unmodified; it fails against the current landed-criteria-drift refusal.
- [x] A test drives the same lane through the daemon pipeline dispatch path (`preparePipelineStageWorkflow`) and asserts the same continuation; it fails against the current refusal.
- [x] A test drives a lane where a checked criterion (absent from base) has no corresponding commit on the branch and asserts continuation refuses, naming the offending subspec path(s) and the fix, with a refusal reason distinct from the unlanded-commits and landed-criteria-drift messages; it fails against a build that has the relaxed gate but no branch-commit check.
- [x] A test asserts `--reset-despite-landed-criteria` on an otherwise-continuable lane retires the workspace instead of continuing, regardless of tick provenance.
- [x] A test covers continuation for an external (`specs: external`) plan tree, including a criterion ticked without a matching commit, and asserts the tick guard does not apply while continuation still proceeds on the existing gates; it fails against the current refusal.
- [x] `reset refuses when worktree has uncommitted tracked changes`, `resetStaleWorkspace still refuses a non-descendant lane with an unlanded commit`, and `resetStaleWorkspace refuses when worktree key is claimed` (`cleanup.test.ts`) stay green — dirty-tree, non-descendant-`HEAD`, and live-owner refusals unchanged.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] A test forks a lane, advances the base with a non-conflicting commit, and asserts re-dispatch rebases the lane onto the new base and continues at the unchecked subspec; it fails against a descendant-only rule.
- [x] A test advances the base with a conflicting commit and asserts re-dispatch aborts the rebase, leaves the worktree and branch unchanged, and refuses naming the conflicting path.

## Documentation updates

- `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — continuation conditions, forged-tick refusal, and override behavior.
- `v2/docs/workflow-runner.md` — re-dispatch continuation, shared across CLI and daemon dispatch.
- `v2/docs/v1-behaviors.md` — incomplete re-dispatch now continues a committed lane (with branch-commit tick verification) instead of refusing.
