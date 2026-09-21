---
name: abandon-refuses-unlanded-work-with-no-pr
---

# `cleanup --abandon` refuses a branch with unlanded commits and no PR

Unsplit rationale: the fix is one admission gate in the cleanup `--abandon` path (plus its flag and doc); no other module boundary changes.

## Primary implementation surface

- `v2/src/commands/cleanup.ts` (`--abandon` admission; flag parsing in `cleanup-cli.ts`)

## Behavior

- `--abandon` refuses when the branch has commits not reachable from the repo base branch and no PR (open or merged) is associated; refusal names tip SHA, commit count, changed-file count, and recovery (hand-finish, or re-run with `--discard-unlanded`).
- `--yes` does not bypass; only `--discard-unlanded` does.
- Branches fully reachable from base abandon as today; bulk merged-worktree retirement unchanged.

## Acceptance criteria

- [ ] New cleanup test `abandon refuses a branch with unlanded commits and no PR`: ahead-of-base, no PR → refusal naming tip SHA and commit count; worktree, local and remote branches untouched, nothing closed; fails pre-fix.
- [ ] New cleanup test `abandon refusal for unlanded work is not bypassed by --yes`.
- [ ] New cleanup test `abandon discards unlanded work under the explicit override`: `--discard-unlanded --yes --abandon` completes ordinary retirement.
- [ ] New cleanup test `abandon retires a branch whose commits are all on base`.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § `--abandon`: the refusal, `--discard-unlanded`, and a session-close note that a circuit-broken lane looks like debris without `git rev-list --count <base>..<branch>`.

## Prerequisites
