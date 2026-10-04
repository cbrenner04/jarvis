## Verdict — changes required before merge

### 1. Absent remote branch must not fail retirement
`performAbandonmentSteps` issues `git push origin --delete <branch>` unconditionally and now treats any nonzero as fatal. A workspace whose run died before its first push (or a repo with no `origin`) has no remote ref — that is the desired end state, not a failure. As written, such a retirement removes the worktree and local branch, then exits `1`; on the implement-rerun path it returns `refused` and blocks the re-run outright.

Required: retirement succeeds when the remote branch does not exist (or there is no `origin` remote) — detect the goal state rather than reporting a hard failure — while a genuine remote-deletion failure (auth, network, protected ref) still aborts before PR closure. Cover this with a test in a repo that has no remote, so the case is exercised end-to-end rather than stubbed away. Note the spec's "remote deletion is a hard failure" decision is about real failures; "already absent" is inside its intent.

### 2. `refused` must not imply "nothing was mutated"
`resetStaleWorkspace` collapses any nonzero retirement into `{status:"refused", reason:"abandonment failed"}`, but the runbook documents refusal as mutation-free with a clean recovery path. Required: the refusal reason names the step that failed, and the operator-facing docs distinguish pre-mutation refusals (live-held, PR-state gates) from a partial teardown that already removed local artifacts.

### 3. Implement-rerun docs still describe the old order — the doc AC is ticked falsely
`v2/docs/operator-runbook.md` (stale-workspace reset section, ~line 206) and the `[v2 additive]` reset entry in `v2/docs/v1-behaviors.md` (~line 77) both still say the reset closes the PR first, then removes the worktree and branch refs. The subspec's Documentation updates section requires the `--abandon` **and** implement-rerun entries to reflect the new order and hard-fail semantics. Required: both entries state the shipped order (worktree → local branch → remote branch → PR) and the abort-on-first-failure behavior. Do not leave the doc-related AC checked until this is true.

### 4. Do not overwrite v1 records with v2 strings in `v1-behaviors.md`
The edited bullet is a v1 entry (`Sources: v1/src/...`) and the branch replaced v1's own documented strings in place: `unsafe PR state for branch …` → `Cannot abandon: matching PR is ready (non-draft)`, lock exit code `9` → `1`, `cancelled` → `Cancelled`, plus deletion of v1's `--abandon` sentence. None of those v1 behaviors changed on this branch, and the file's convention is to record v2 divergence as a separate `[v2 difference]` entry. Required: v1 text restored verbatim; the v2 retirement delta lives in its own `[v2 difference]` entry.

### 5. Land the dead-parameter cleanup
The committed code still carries `removeWorktreeAndBranch(options: { force?, deleteRemoteBranch? })` with an unreachable remote-delete block, now that the retirement path sequences those steps itself. The removal exists only in the uncommitted working tree. Required: the committed state has no dead options surface on that helper, and `performWorktreeRemovals` retains its unforced removal and best-effort local-branch warning (the spec explicitly keeps bulk cleanup's strictness unchanged).

### 6. Runbook must say where a partial retirement stops and how to finish it
The added `--abandon` paragraph asserts "an open PR indicates incomplete retirement," which only holds when a PR exists, and gives no manual completion path — and once the worktree is gone the command cannot resume (name resolution enumerates materialized worktrees only). Required: the runbook states which artifacts may remain after each abort point and the manual steps to finish (delete the remote branch, close the PR). Making abandon resumable is out of scope.

### 7. Test-double hygiene
- `mergedPrRunner` in `cleanup-cli.test.ts` now intercepts *any* `git push origin …` (it matches only `args[1] === "origin"`) and stubs `gh pr list → "[]"` for every test using the helper, which can silently satisfy unrelated archival preconditions. Required: stubs match only the commands the test intends to fake.
- The PR-closure-failure test asserts `toContain("close-pr")` while its three siblings assert exact step sequences. Required: it asserts the full observed sequence, proving the remote delete ran and nothing followed the failure.

### Declined
The duplication between the retirement sequence and `performWorktreeRemovals` is not a defect to fix: the spec deliberately rules out threading force/strictness flags through the shared helper, and the two paths have genuinely different failure policies.