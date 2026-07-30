# Prune merged dead branch refs

## Problem

Default `jarvis cleanup` discovers branches only through managed worktrees.
A merged branch without a worktree therefore leaves both its local head and
`origin` tracking ref behind. Successful merged-worktree retirement also
deletes only the local head.

## Decision ledger

- Enumerate `refs/heads/*` from each registered project independently of managed-worktree discovery; rules out keeping worktree presence as the branch-prune admission source.
- Admit only a branch whose matching PR state is `MERGED`; an open matching PR vetoes pruning, and closed-unmerged, no-PR, or failed/ambiguous `gh` lookup stays untouched, ruling out Git ancestry or a partial PR lookup as deletion authority.
- Exclude `main`, the project checkout's current branch, and any branch checked out in a worktree that cleanup does not successfully retire; rules out deleting the base/current branch, bypassing managed-worktree eligibility, or touching co-located non-project checkouts.
- Successfully retired merged worktrees use the same ref-prune path after retirement; rules out a second worktree-only behavior that continues leaving `refs/remotes/origin/<branch>`.
- Candidate discovery starts from local heads; an orphan `refs/remotes/origin/*` ref without a matching local head stays untouched, ruling out a broad remote-tracking namespace sweep.
- Delete only `refs/heads/<branch>` and the local `refs/remotes/origin/<branch>` when present; rules out `git push origin --delete` or any mutation of the remote repository.
- Dry-run and apply name each existing full ref separately; dry-run performs no ref, worktree, artifact, socket, or remote mutation, ruling out a branch-level summary that hides partial pruning.
- A failed ref deletion is reported without a success line and makes cleanup nonzero while other eligible candidates continue; rules out silent partial success or fail-fast loss of later cleanup work.
- Preserve existing artifact archival, daemon-socket reaping, confirmation, and merged-worktree eligibility behavior; rules out widening this branch-lifecycle change into adjacent cleanup semantics.

## Task checklist

- [ ] Add registered-project local-head discovery and explicit exclusions for `main`, current/checked-out branches, and branches owned by worktrees not retired by this cleanup invocation.
- [ ] Reuse the cleanup PR-state seam to select only merged branches, with an open PR as a deletion veto and all non-merged/no-result/error cases fail-closed.
- [ ] Prune eligible local heads and existing local `origin` tracking refs without deleting remote branches; route successfully retired managed worktrees through the tracking-ref prune.
- [ ] Extend dry-run, apply, and error output so every affected full ref is visible and partial failures produce a nonzero result while later candidates continue.
- [ ] Add offline fixture and injected-runner coverage in `v2/src/commands/cleanup.test.ts`; extend CLI coverage only if command-boundary wiring changes.
- [ ] Update the durable cleanup contracts named below.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `default cleanup prunes merged branch refs without a materialized worktree` fails against the pre-fix tree and passes after: apply removes `refs/heads/<branch>` and an existing `refs/remotes/origin/<branch>`, reports both full refs, and never invokes remote-branch deletion.
- [ ] `v2/src/commands/cleanup.test.ts` test `default merged-worktree retirement prunes origin tracking ref` fails against the pre-fix tree and passes after: successful retirement removes and reports both local refs.
- [ ] `v2/src/commands/cleanup.test.ts` test `dry-run previews merged dead refs without mutation` fails against the pre-fix tree and passes after: every would-prune full ref is listed while local heads, tracking refs, worktrees, artifacts, sockets, and the remote remain unchanged.
- [ ] Guard-inversion coverage in `v2/src/commands/cleanup.test.ts` fails when any exclusion is removed: `main`, the project checkout's current branch, open/closed-unmerged PR, no PR at both merged and unmerged Git ancestry, failed/ambiguous PR lookup, a managed worktree that is not retired, and a co-located non-project checkout each retain both local refs and emit no prune-success line.
- [ ] Guard-inversion coverage in `v2/src/commands/cleanup.test.ts` fails if an orphan tracking ref is swept, if remote deletion is attempted, or if a failed local/tracking-ref deletion is reported as success or returns zero; later eligible candidates are still pruned.
- [ ] Existing `v2/src/commands/cleanup.test.ts` merged-worktree eligibility, artifact archival, `--abandon`, and stale-reset coverage stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document worktree-independent merged-branch pruning, exclusions, local-only ref scope, failure behavior, and dry-run/apply reporting.
- `v2/docs/v1-behaviors.md` — replace the claim that v2 bulk cleanup never touches remote refs: it never deletes a remote branch, but it prunes local `origin` tracking refs and merged local heads independently of worktrees.
