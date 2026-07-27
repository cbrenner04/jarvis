# Remote branch existence via `ls-remote`

## Problem

`branchExistsOnOrigin` / `branchExistsOnOriginAsync` (`shared/git.ts`) treat
`git rev-parse --verify origin/<branch>` as proof the branch exists on the remote.
A stale `refs/remotes/origin/<branch>` after the remote ref was deleted (squash-merge,
`git push origin --delete`, hand-merge) makes materialization recreate the run branch from
pre-merge history (`v2/src/execution/external-worktree.ts`) instead of `--base`.

The helpers are shared: v1 worktree/base paths and v2 external materialization both call them
today, not only `external-worktree.ts`.

## Decisions

- `branchExistsOnOrigin(Async)` returns true only when `git ls-remote --heads origin <branchName>`
  in `projectRoot` emits at least one line whose ref is exactly `refs/heads/<branchName>` (exact
  branch name, no wildcards). Rules out `rev-parse origin/<branch>` as the remoteness check.
- When `ls-remote` fails (no `origin`, subprocess error) or returns no matching head, treat the
  branch as absent on the remote (false). Rules out falling back to `rev-parse`, which would
  re-trust a stale tracking ref on fetch/network failure.
- **v1 product decision:** v1 keeps using `branchExistsOnOrigin` / `branchExistsOnOriginAsync` with
  the same `ls-remote` + fail-closed-false contract (no separate v1-only `rev-parse` path). Offline,
  auth, or network failure during a check can treat an actually-existing remote branch as absent and
  bias v1/v2 toward local/`--base` paths; document deliberately — other harness paths may soften
  remote checks on failure.
- Sync and async helpers stay paired; update `shared/subprocess.test.ts` parity coverage. Rules out
  async-only fix.
- `external-worktree.ts` keeps calling `branchExistsOnOriginAsync`; no duplicate remoteness logic
  in materialization. Rules out a one-off check in `external-worktree.ts` only.
- Preserved “materialize from remote” behavior assumes today’s happy-path fixture/setup (local
  tracking ref and/or local branch already present). **Out of scope:** remote head exists per
  `ls-remote` but was never fetched locally / implicit fetch-before-branch — separate intent if
  needed.

## Task checklist

- [ ] Replace the `rev-parse origin/<branch>` probe in `branchExistsOnOrigin` /
  `branchExistsOnOriginAsync` with `ls-remote --heads origin <branchName>` per the matching
  contract above.
- [ ] Update `shared/git.ts` module/JSDoc that still describes fetch-then-local-tracking as the
  remoteness contract.
- [ ] Extend `shared/git.test.ts` and `shared/subprocess.test.ts` for the new subprocess shape;
  add a fixture-backed case: local `origin/<branch>` tracking ref present, bare `origin` has no
  such head ⇒ false.
- [ ] Update git fakes/shims that stub remoteness via `rev-parse --verify origin/<branch>` (notably
  `createWorktreeRunner` in `external-worktree.test.ts` and any other suites found by audit) so they
  emulate `ls-remote --heads` consistently with production.
- [ ] Add `external-worktree.test.ts` coverage: with only a stale tracking ref (no ls-remote head),
  materialization takes the `--base` path, not `git branch <name> origin/<name>`.

## Acceptance criteria

- [x] `shared/git.test.ts` `branchExistsOnOrigin true only when ls-remote reports a head` (or the
  implemented test name) fails against the pre-fix code and passes after the change; it asserts
  false when only a stale `origin/<branch>` tracking ref remains.
- [x] Guard-inversion coverage on the ls-remote gate fails when inverted: with only a stale
  tracking ref, materialization must take the `--base` path, not `git branch <name> origin/<name>`.
- [x] `shared/subprocess.test.ts` `branchExistsOnOrigin and branchExistsOnOriginAsync agree on success and failure` stays green.
- [x] `external-worktree.test.ts` `describe("external worktree helper")` stays green (remote-path
  materialization unchanged for today’s fixture shape).
- [x] `v1/test/run.test.ts` `describe("stale external-spec rerun cleanup")` stays green under the
  shared `ls-remote` helper contract.

## Documentation updates

- `v2/docs/v1-behaviors.md` — `branchExistsOnOrigin` / `branchExistsOnOriginAsync` (v1 and v2):
  remote-branch presence is `ls-remote --heads`, not a local remote-tracking ref alone; fail-closed
  false on `ls-remote` error/empty (operator trade vs softened checks elsewhere).
- `v2/docs/operator-runbook.md` — materialization/remoteness: offline or auth failure during
  `ls-remote` can treat an existing remote branch as absent and fall back to `--base`.
