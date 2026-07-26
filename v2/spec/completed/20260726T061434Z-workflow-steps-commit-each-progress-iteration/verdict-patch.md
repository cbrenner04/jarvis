## Verdict — changes required

### Must fix

**1. The pre-implement anchor must be sampled before any of the implement step's iterations can commit, in all cases.**
The anchor is currently sampled before `runWorkflowStep`, but only opportunistically: if the external worktree doesn't exist yet, `git rev-parse` throws, the value is `undefined`, and a post-step fallback re-samples HEAD *after* the step's own progress iterations have committed — anchoring the shrink/publication reset at the last iteration commit, which is exactly the bug AC-6 exists to prevent. The main `jarvis run workflow implement` path only survives this because the daemon pre-materializes the worktree for index specs (`daemon.ts`, gated on `linkedIndexRouting`); non-index implement specs take the broken path, and the correct behavior depends on an unrelated conditional in another file with nothing tying them together.

Required outcome: materialize the external worktree before sampling in `executeWorkflow` (the same `withExternalWorktree` no-op call already used elsewhere in this file and in the daemon), sample the anchor unconditionally, and delete the post-step fallback. A regression test must cover an implement/shrink run whose worktree does **not** pre-exist — every current shrink test uses `createShrinkTestStep`, which points `localPath` at an already-initialized repo and so never exercises the lazy path.

**2. Remove the dead `headBeforePreShrinkCommit !== undefined` conjunct guarding `preShrinkCommit` assignment.**
It encodes a state that cannot occur (a returned `commitSha` implies `.git` and a reachable HEAD), and if it ever could, the effect would be to silently skip the publication reset entirely. It should disappear with the fallback.

**3. Doc corrections in `v2/docs/write-behavior.md`:**
- Drop the "falling back to a post-step sample when the worktree didn't exist yet" clause — that fallback is being removed, and documenting it as benign is wrong.
- Reword the skip condition to key on **`.git` absence**, not on `worktree.git: false`. The code guards on `.git`, which is the correct general invariant; `git: false` steps skip only because their `localPath` points at a non-repo staging dir. The branch's own plan test — a `git: false` step whose `localPath` *is* a repo, which commits fine — is a live counterexample to the stronger claim.

**4. `v2/docs/v1-behaviors.md` overstates the visible cadence.**
For implement steps that reach shrink, publication resets `--mixed` to pre-implement HEAD and makes a single commit; the new test asserts exactly one commit on the branch. Per-iteration commits there are a **crash-recovery** guarantee, not an attribution-visible commit cadence. Since that sentence sits directly next to the PR-attribution claim, it must say so.

**5. Spec `## Decisions` contradicts the implementation on the capture point.**
It says `headBefore` is captured "before the pre-shrink committer call"; the code captures before the whole step — correctly, since capturing before the pre-shrink call would be post-iteration-commits and useless. Correct the spec's wording to match (and ensure the code comment states the true reason).

### Should fix (cheap, quality)

**6. Test defects:**
- In the shrink-anchor test, the comment "Two progress-iteration commits occurred" sits above an assertion of `1` commit; it describes pre-reset state and contradicts the assertion as written. Reword or relocate.
- The plan/staging test's `expect(commitCount).toBeGreaterThanOrEqual(2)` does not isolate the in-flight iteration commit — landing plus terminal completion alone can reach 2. Assert something that only an in-flight commit can satisfy, e.g. that some commit in `preRunHead..HEAD` has the staging dir in its tree.
- The `no_git` block's `finally` restores the store but not the `./write.ts` module mock that every sibling block restores; a throw there leaks the mock file-wide.

**7. `IterationCommitEvent` should be a discriminated union**, not two optional fields. As typed it admits `{}` and `{commitSha, skipReason}`, neither of which is a real state; the producer already has the correct union (`ProgressIterationCommitOutcome`), and `RuntimeSmokeOutcomeEvent` in the same file establishes the union idiom.

**8. AC-5's `.git`-guard test should use the shape the criterion names** — a worktree input with `git: false` and a `localPath`, rather than a bare `mkdirSync`'d directory. Same code path, two fields, and it matches the criterion the spec committed to.

**9. Rename `preShrinkCommit`.** It no longer holds a commit this code created; it holds the pre-implement reset anchor. This change exists specifically to disambiguate created-from-reused, so the name shouldn't reintroduce the confusion.

### Not upheld

- Missing reset when the anchor is unavailable: unreachable as written (subsumed by item 2).
- Unborn-HEAD risk from the new `rev-parse` in `commitProgressIteration`: the completion committer already ran `rev-parse HEAD` unconditionally, so this adds no failure surface — only the (now-removed) workflow-runner fallback introduced an unguarded one.
- AC-7's plan test using a `git: false` worktree over a real repo: it exercises real git history, which is the criterion's substance. If the fixture shape isn't changed, add a one-line comment noting the divergence from production step shapes.