# Scoped cleanup --abandon

## Problem

`jarvis1 cleanup --abandon` scans every `.worktree/*` entry. Dry-run and
confirmation list all eligible abandoned worktrees, so the command is unsafe when
the operator needs to retire exactly one stale tree after triage.

## Behavior

Add an optional positional `<worktree-name>` to `jarvis1 cleanup --abandon`
(combinable with `--dry-run`). The name is the `.worktree/` directory basename
(same as `jarvis1 triage <worktree-name>` and `jarvis1 review-feedback
<worktree-name>`).

**Scoped mode** (`--abandon` + name): resolve only `.worktree/<worktree-name>/`.
Before confirmation or removal, print the target worktree path and branch. Retire
with the same abandon semantics as today (`isEligibleForAbandon` +
`retireAbandonedWorktree`: close one matching draft PR best-effort, force-remove
worktree, delete local and remote branch, no spec archival). Refuse with a clear
error and make no changes when the name is unknown, the branch's PR is merged, a
ready/non-draft PR matches, multiple open PRs match, PR inspection fails, or a
live `.jarvis.lock` is held (stale locks do not block). `--dry-run` previews only
the named target.

**Global mode** (`--abandon` without name): unchanged — scan all `.worktree/*`
entries, skip ineligible trees with logged reasons, preview/confirm the eligible
set.

Default merged-cleanup (no `--abandon`) is unchanged.

## Decisions

- Optional positional on `cleanup --abandon`, not a new subcommand — rules out `jarvis1 triage <worktree-name> --abandon` and a separate retire command.
- Omitting the positional keeps the existing global scan — rules out requiring a name on every abandon invocation.
- Scoped mode refuses ineligible named targets with stderr + non-zero exit — rules out global-mode skip-and-continue when the operator named one tree.
- Scoped dry-run lists only the named target — rules out previewing unrelated abandoned worktrees.
- Reuse `isEligibleForAbandon` and `retireAbandonedWorktree` — rules out a parallel abandon implementation with different PR/branch semantics.
- Live-lock guard uses `.worktree/<worktree-name>/.jarvis.lock` with alive-PID semantics (stale ignored) — rules out refusing on stale lock files and rules out retiring while a run holds the lock.
- Lock refusal reuses patch lock wording (`worktree is in use by process <pid> (started at <timestamp>)`) and exit `9` — rules out inventing a new error shape or exit class.
- Other scoped refusal cases exit `1` — rules out treating guard failures as successful no-ops.
- Preview prints worktree path and branch before confirm/dry-run — rules out branch-only listing for the named target.
- Deferred to first consumer: confirmation prompt shape for a single named target — pin when CLI UX is drafted.
- Deferred to first consumer: behavior when `<worktree-name>` is passed without `--abandon` — pin when CLI parsing is drafted.

## Tasks

- [ ] Parse optional `<worktree-name>` on `cleanup --abandon` in `v1/src/cli.ts`; thread through to `cleanupCommand`.
- [ ] Add scoped abandon path in `v1/src/commands/cleanup.ts` (resolve one worktree, lock guard, refuse vs retire).
- [ ] Tests in `v1/test/cleanup-command.sandbox-unrunnable.test.ts` and `v1/test/cli.sandbox-unrunnable.test.ts` for scoped retire, guards, dry-run, and global preservation.
- [ ] Update `cleanup` usage/help in `v1/src/cli.ts`.
- [ ] Update `v2/docs/v1-behaviors.md` cleanup entry.

## Acceptance criteria

- [ ] `jarvis1 cleanup --abandon <worktree-name>` retires only the named eligible worktree: closes at most one matching draft PR best-effort, force-removes the worktree, deletes local and remote branch, and leaves the source spec directory on disk unmodified.
- [ ] Scoped abandon prints the target worktree path and branch before the confirmation prompt or before exiting on `--dry-run`.
- [ ] Unknown `<worktree-name>` refuses with a clear error, exits non-zero, and makes no changes.
- [ ] Named target whose branch PR is merged refuses with a clear error, exits non-zero, and makes no changes.
- [ ] Named target with an open ready/non-draft PR refuses with a clear error, exits non-zero, and makes no changes.
- [ ] Named target with multiple open matching PRs refuses with a clear error, exits non-zero, and makes no changes.
- [ ] Named target when `findMatchingOpenPrs` inspection fails refuses with a clear error, exits non-zero, and makes no changes.
- [ ] Named target with a live `.jarvis.lock` refuses with `worktree is in use by process <pid> (started at <timestamp>)`, exits `9`, and makes no changes.
- [ ] Named target with only a stale `.jarvis.lock` (dead PID) is not blocked from scoped abandon.
- [ ] `jarvis1 cleanup --abandon --dry-run <worktree-name>` previews only the named target (no unrelated worktrees listed), suppresses confirmation, and makes no changes.
- [ ] Declining the scoped confirmation prompt cancels with no side effects.
- [ ] `jarvis1 cleanup --abandon` without `<worktree-name>` behavior is unchanged (`cleanup-command.sandbox-unrunnable.test.ts` global abandon tests stay green).
- [ ] `cleanup` help/usage documents optional `[<worktree-name>]` with `--abandon`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — scoped abandon surface, refusal guards, dry-run scoping, and global-mode preservation.
- `v1/src/cli.ts` — `cleanup` usage/help for optional `[<worktree-name>]` with `--abandon`.
