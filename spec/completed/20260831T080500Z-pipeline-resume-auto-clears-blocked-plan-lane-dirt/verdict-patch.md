1. Branch-scoped resume must reset and dispatch only the reopened lane. Approved or pending sibling lanes must remain untouched; current fan-out resolution can act on them, violating the branch-scoped resume contract.

2. Failed-plan redraft policy must survive claim loss, detached-continuation interruption, and daemon restart. Continuation must retain or reconstruct the reopened stage/branch reset policy and blocker protection; otherwise the documented automatic reset is lost after reopen.

3. Blocker detection must distinguish operator-authored blockers from reserved harness-only `Artifact contract check failed:` blockers. Harness-only blockers must permit redraft; any non-reserved blocker, including one alongside harness blockers, must preserve the worktree and refuse dispatch.

4. Failed-plan redraft must fail closed when stale-reset preparation cannot run. It must never dispatch without completing reset and guard evaluation, because rematerialization and the live-ownership, descendant, blocker, and landed-criteria protections are required guarantees. Existing fail-open behavior outside this new path need not change.

Each outcome requires regression coverage and durable documentation alignment.
