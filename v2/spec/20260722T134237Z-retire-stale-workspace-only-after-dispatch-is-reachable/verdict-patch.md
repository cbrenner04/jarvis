## Verdict

### Upheld — required outcomes

**1. The daemon-auto-start side effect on the refusal path must be documented.**
Retirement now runs inside the connected dispatch scope, and the connect path auto-starts a daemon when none is listening (`v2/src/cli/stale-dispatch.ts:14`). Consequence: a re-run that is *refused* by the stale-workspace guard (live-held workspace, non-draft PR, multiple matching PRs) can now leave a daemon process running, where previously such a refusal made zero daemon contact. That is an operator-visible behavior change introduced by this branch and is currently unrecorded. It must appear in the durable home for changed v2 semantics (`v2/docs/v1-behaviors.md`, and the runbook paragraph if the operator needs it for recovery).

**2. Fix the doc sentence that stacked clauses instead of replacing them.**
The `v1-behaviors.md` entry now reads "after a successful step build and after the daemon connection is established and before daemon `start`" — three chained clauses where one suffices ("after a successful step build and daemon connect, before daemon `start`"). Repo convention is terse durable prose; tighten it while making the edit in (1).

**3. Remote-branch survival must be observed, not inferred.**
Acceptance criterion 1 claims the new test asserts "both local and remote branch refs survive." The fixture repo has no remote and the assertion set never observes any `git push --delete`/remote ref. Either make the test actually observe the remote half (give the fixture a remote, or capture the delete-push call shape), or bring the criterion's wording in line with what is actually asserted. A ticked criterion must be backed by what the test observes, not by reasoning about retirement's all-or-nothing structure.

**4. The new dispatch-unreachable test must assert the operator-visible failure output.**
It currently asserts only exit `1` plus absence of teardown, and accepts silent stderr — unlike every sibling test in the `implement preflight stale workspace reset` block. Add an assertion on the emitted failure message so the test pins *why* the run exited, not just that it did.

**5. Error classification for reset failures must not be silently mislabeled.**
Any unexpected exception escaping `maybeResetStaleWorkspace` is now caught by `withConnectDispatch` with a live client and rendered through `formatConnectionError` — a workspace-teardown failure reported to the operator as a daemon connection problem. The catch itself is an improvement over unhandled propagation; the misleading label is the defect. Either classify reset-originated failures distinctly, or record this as a known limitation in the subspec so it is not mistaken for correct attribution later.

### Noted, no action required in this branch

Failures *after* a successful connect but during `start` (RPC error, malformed response, daemon dying mid-dispatch) still land after retirement has already run. This cannot be fixed by reordering — retirement must precede `start` because materialization recreates the worktree from `--base` — so closing it requires a reserve-then-dispatch or daemon-side retirement design. Out of scope here; it deserves its own intent rather than an expansion of this change.

### Not upheld

- Test names using "before daemon start" — matches the repo's existing `v1-behaviors.md` vocabulary for the `start` RPC; renaming is cosmetic.
- The `connectAttempted` flag — it is a vacuity guard proving the test reached the dispatch seam, not a redundant ordering assertion.
- Absence of a `git worktree remove` call filter — the direct end-state check on `git worktree list` is the stronger assertion.