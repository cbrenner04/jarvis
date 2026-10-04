# Discover merged branch-ref candidates

## Problem

Cleanup discovers branches only through managed worktrees, so merged local
heads with no worktree are never considered. Local-head discovery needs an
equally conservative replacement for that project boundary.

## Decision ledger

- Discover `refs/heads/*` per distinct registered Git repository, not from managed-worktree directories; missing, inaccessible, or non-Git roots are identified, remaining projects continue, and cleanup finishes nonzero.
- Deduplicate registry entries that resolve to the same repository; full ref names are repository-local and candidates must not be processed twice.
- Run every PR lookup in that repository's context. A branch is eligible only when one unambiguous matching PR is `MERGED` and its head OID equals the current local-head OID; reused names, post-merge commits, conflicting matches, open PRs, no PR, closed-unmerged PRs, and lookup errors or ambiguity fail closed.
- Exclude `main`, the project checkout's current branch, and every branch checked out anywhere in the repository's complete worktree metadata, including linked worktrees outside Jarvis directories. A managed-worktree branch becomes eligible only after this invocation successfully retires it.
- Candidate discovery starts from exact local heads. Orphan `refs/remotes/origin/*` refs are not candidates.

## Task checklist

- [ ] Discover local heads from each usable registered project; identify unusable roots, isolate projects, and deduplicate repository identities.
- [ ] Resolve PR authority in the candidate repository and require one merged PR whose recorded head OID equals the local head.
- [ ] Discover current and checked-out branches from complete worktree metadata, including external linked worktrees, and retain branches not successfully retired by this invocation.
- [ ] Add offline fixture and injected-runner coverage in `v2/src/commands/cleanup.test.ts`; extend CLI coverage only if command-boundary wiring changes.

## Acceptance criteria

- [x] `v2/src/commands/cleanup.test.ts` test `merged local head candidate requires matching merged PR head` fails against the pre-fix tree and passes after: a local merged-PR head without a materialized worktree is admitted only when its OID matches one unambiguous merged PR in that project.
- [x] Guard-inversion coverage in `v2/src/commands/cleanup.test.ts` fails if PR lookup is not run in the candidate repository, if OID matching is removed, or if an open PR, closed-unmerged PR, no PR at merged or unmerged Git ancestry, reused/historical branch, post-merge commit, conflicting PR match, or failed/ambiguous lookup is admitted.
- [x] Guard-inversion coverage in `v2/src/commands/cleanup.test.ts` fails if `main`, the project checkout's current branch, a branch held by an unretired managed worktree, or a co-located external linked checkout is admitted; each retains both local refs and emits no prune-success line.
- [x] `v2/src/commands/cleanup.test.ts` test `candidate discovery isolates registered projects` fails against the pre-fix tree and passes after: identical branch names with different PR states are evaluated in their own repositories, invalid registered roots are named and make cleanup nonzero without blocking unrelated projects, and duplicate registry entries process a repository once.

## Documentation updates

- None in this slice; the final documentation slice records the completed operator contract.
