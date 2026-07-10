# Verdict — Finalize PR attribution and ready

## Upheld issues

The implementation satisfies the completed spec’s acceptance criteria: collapse-model attribution, post-PR body refresh with narrative preservation, two retryable boundaries (`completion_commit_failed` then `ready_finalize_failed`), ready-gate-before-flip ordering, and the `already ready` / `not a draft` success guard before transient retry. Resume republication on an existing completion commit is correct (`git log --format=%B` includes the subject line).

Three operational gaps remain before this slice is production-safe:

1. **Asymmetric `gh` worktree context** — Body refresh runs `gh` with the external worktree as `cwd`; PR list/create and `gh pr ready` do not. When the daemon runs outside `~/.jarvis/worktrees/...`, ensure/flip can target a different repository than refresh and git.
2. **Duplicated publication wiring in workflows** — `executeWriteLoop` routes publication+finalization through `publishCompletionArtifacts` with typed failure kinds; `executeWorkflow` inlines the same steps and classifies failures by matching error-message prefixes. Behavior can drift and misclassify edge cases.
3. **Operator docs lag implementation** — `write-behavior.md` still opens with a two-step publication model (“commit, then push+PR”) while later sections describe refresh and a separate finalization boundary. The **Exit codes** and **Wait exit codes** tables omit `completion_commit_failed` and `ready_finalize_failed`, though the prose and CLI already map them to exit `1`.

Not upheld as actuator work: resume-republication skip; multi-agent attribution (explicitly deferred in spec); partial narrative markers (unspecified); git-log-failure→empty-footer (v1 parity); coarse transient-retry classifier (spec choice).

---

## Required outcomes

1. **All publication and finalization `gh` calls must run in the completed run’s worktree context**, matching git operations and body refresh. PR list, create, view/edit (refresh), and `gh pr ready` must resolve the same repository/remote as the branch being published. Outcome: a daemon session started outside the worktree still ensures, refreshes, and flips the correct draft PR for that run.

2. **PR lookup must not be weaker than v1’s repo-scoped behavior.** Branch-only `gh pr list --head` without worktree `cwd` and without scoping to the worktree’s current repo can miss or reuse the wrong PR when remotes, forks, or duplicate branch names exist. Outcome: find-or-create and flip operate on the PR belonging to the worktree’s repository.

3. **`executeWorkflow` must reuse the same publication+finalization boundary as `executeWriteLoop`** — one ordered path (push → PR ensure → body refresh → ready gate → flip) with typed `completion_commit_failed` / `ready_finalize_failed` outcomes, not parallel inline wiring keyed off error-message substrings. Outcome: workflow and standalone write runs share identical failure surfaces and resume semantics.

4. **`v2/docs/write-behavior.md` must match the implemented lifecycle:**
   - Opening summary: publication = commit → push+PR → body refresh; finalization = ready gate → draft→ready flip (separate boundary).
   - **Exit codes** and **Wait exit codes** tables: document that `completion_commit_failed` and `ready_finalize_failed` exit `1` with `runStatus: completed` and `resumable: true`, consistent with existing prose and `cli.ts`.

5. **Add write-loop integration coverage for completed-run resume after a prior publication failure** (commit already on HEAD, publisher/finalizer not yet successful). Module tests cover pieces; an end-to-end resume through `executeWriteLoop` guards the spec’s “resume replays publication first” contract against future wiring regressions.

---

## Rationale

Outcomes 1–2 address a real correctness bug: external worktrees are the v2 norm, and partial `cwd` wiring breaks the spec’s requirement that refresh “edits the ensured PR” and that flip runs on that same PR. Outcome 3 prevents the workflow path from diverging on failure typing and ordering — a maintainability defect that can surface wrong `loopOutcomeKind` values to operators. Outcome 4 closes gaps against the spec’s documentation acceptance criteria and operator-facing exit-code tables. Outcome 5 is defense-in-depth on resume idempotency, which the spec promises but only unit tests at submodule boundaries currently exercise.
