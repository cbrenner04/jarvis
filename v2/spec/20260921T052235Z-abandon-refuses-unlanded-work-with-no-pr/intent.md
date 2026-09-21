---
name: abandon-refuses-unlanded-work-with-no-pr
---

# `cleanup --abandon` refuses a branch with unlanded commits and no PR

Unsplit rationale: the fix is one admission gate in the cleanup `--abandon` path (plus its flag and doc); no other module boundary changes.

## Primary implementation surface

- `v2/src/commands/cleanup.ts` (`--abandon` admission; flag parsing in `cleanup-cli.ts`)

## Behavior

- `--abandon` reuses the stale-reset unlanded-commits predicate (`unlandedCommitCount` / `unlandedNonStagingPaths` / `carriesNoUnlandedCommits`, `staleResetUnlandedCommitsGateReason` wording) so the two gates cannot diverge: refuses when the branch has commits not reachable from the repo base branch whose changed paths leave harness workflow staging (`.jarvis-plan-stage/`, `.jarvis-intent-stage/`, `.jarvis-*` sidecars) and no open PR exists. Staging-only branches abandon as today.
- Refusal names tip SHA, commit count, and recovery (hand-finish, or re-run with `--discard-unlanded`).
- Open PR cases keep today's behavior: a draft PR with unlanded commits proceeds (the PR is closed during retirement); ready and multi-open-PR cases refuse as today; a merged PR still refuses as today. A closed-unmerged PR counts as no PR.
- `gh` unreachable stays fail-closed (existing pre-mutation refusal).
- Applies to every `--abandon` target: scoped `--abandon <name>` refuses exit `1`; global `--abandon` skips the branch with the same reason. Bulk merged-worktree retirement (non-abandon) is excluded and unchanged.
- `--yes` does not bypass; only `--discard-unlanded` does. `--discard-unlanded` is accepted only with `--abandon`; without it the CLI prints usage and exits `1`.
- Branches fully reachable from base abandon as today.

## Acceptance criteria

- [ ] New cleanup test `abandon refuses a branch with unlanded commits and no PR`: ahead-of-base non-staging commits, no PR → refusal naming tip SHA and commit count; worktree, local and remote branches untouched, no PR close attempted; fails pre-fix.
- [ ] New cleanup test `abandon refusal for unlanded work is not bypassed by --yes`.
- [ ] New cleanup test `abandon discards unlanded work under the explicit override`: `--discard-unlanded --yes --abandon` completes ordinary retirement.
- [ ] New cleanup test `abandon retires a branch whose commits are all on base`.
- [ ] New cleanup test `abandon retires a branch whose only unlanded commits are harness staging`.
- [ ] New cleanup test `abandon proceeds for a draft PR with unlanded commits`: the PR is closed and the branch retired.
- [ ] New cleanup test `abandon refuses unlanded work when the PR is closed unmerged`.
- [ ] New cleanup test `abandon refuses when gh is unreachable and the branch has unlanded commits` (fail-closed; nothing retired).
- [ ] New cleanup test `global abandon skips a branch with unlanded commits and no PR`.
- [ ] New cleanup-cli test `--discard-unlanded without --abandon prints usage`.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § `--abandon`: the refusal, `--discard-unlanded`, and a session-close note that a circuit-broken lane looks like debris without `git rev-list --count <base>..<branch>`.
- `v2/docs/v1-behaviors.md`: extend the `[v2 difference]` `cleanup --abandon` entry (line 97) with the unlanded-commits gate, its staging exemption, draft-PR/closed-PR behavior, and `--discard-unlanded`.

## Prerequisites

- `resetStaleWorkspace` already carries the unlanded-commits gate (`unlandedCommitCount`, `unlandedNonStagingPaths`, `staleResetUnlandedCommitsGateReason`) in `v2/src/commands/cleanup.ts`.
