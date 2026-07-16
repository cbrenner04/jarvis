# 00 - Retire merged v2 workspaces

Add the cleanup operation that safely reclaims merged worktrees created under one registered project's external v2 worktree home. CLI exposure follows separately.

## Decisions

- Discover registered Git worktrees beneath `~/.jarvis/worktrees/<project>/`, including slash-nested branch paths; rules out assuming candidates are immediate child directories.
- Require a merged PR for the worktree branch; rules out treating age, clean status, or a completed run row as merge evidence.
- Treat current open/resumable durable ownership or daemon-live ownership as a guard, while superseded and completed/killed history does not own the workspace; rules out both concurrent deletion and permanent retention from historical rows.
- Force-remove confirmed merged worktrees and delete only their local branches; rules out dirty merged trees surviving cleanup or remote branches being deleted.
- Preserve durable run rows and all spec/ready-intent artifacts; rules out coupling workspace retirement to history deletion or archival.
- Make preview and execution consume the same eligible-candidate result; rules out safety drift between dry-run and confirmed retirement.

## Acceptance criteria

- [ ] The cleanup operation finds merged Git worktrees beneath the selected project's `~/.jarvis/worktrees/<project>/` home, including worktrees whose branch names create nested directories, and excludes other projects and unmerged branches.
- [ ] Cleanup excludes a candidate owned by an open durable run or a daemon-live run, with a concise skip reason, even when its PR is merged.
- [ ] Preview reports each eligible worktree and local branch removal without mutation; execution force-removes each selected worktree from disk and Git registration and deletes its local branch.
- [ ] Execution leaves remote branches, durable run rows, specs, and ready intents unchanged.
- [ ] Candidate inspection or retirement failures are named, do not authorize unsafe removal, and produce a non-zero result without preventing independent eligible candidates from being attempted.
- [ ] New `v2/src/commands/cleanup.test.ts` regression coverage exercises merged discovery, open/live ownership guards, preview, dirty-worktree retirement, partial failure, and durable-row retention; the behavior tests fail against the pre-fix code and pass after implementation.

## Documentation updates

None — this is an internal operation; operator semantics land with its first CLI consumer in subspec 01.
