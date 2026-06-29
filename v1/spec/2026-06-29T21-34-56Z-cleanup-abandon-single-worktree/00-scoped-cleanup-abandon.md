# Scoped cleanup --abandon

## Problem

`jarvis1 cleanup --abandon` scans every `.worktree/*` entry. Dry-run and
confirmation list all eligible abandoned worktrees, so the command is unsafe when
the operator needs to retire exactly one stale tree after triage.

## Behavior

Add an optional positional `<worktree-name>` to `jarvis1 cleanup --abandon`
(combinable with `--dry-run`; flag order independent). The name is the
`.worktree/` directory basename (same as `jarvis1 triage <worktree-name>` and
`jarvis1 review-feedback <worktree-name>`). Extra positionals are a usage error.

**Scoped mode** (`--abandon` + name): resolve only `.worktree/<worktree-name>/`.
Before confirmation or removal, print the scoped preview on stdout (see Decisions).
Retire with `retireAbandonedWorktree` (close one matching draft PR best-effort,
force-remove worktree, delete local and remote branch, no spec archival). Eligibility
uses the same PR/merged/draft/multi rules as global abandon via a scoped path
(refactor or wrapper shared with `isEligibleForAbandon` logic) that fails fast on
stderr — not a direct call to `isEligibleForAbandon` unchanged. Refuse with pinned
stderr messages (see Acceptance criteria) and make no changes when guards fail.
`--dry-run` previews only the named target.

**Global mode** (`--abandon` without name): unchanged — scan all `.worktree/*`
entries, skip ineligible trees with logged reasons, preview/confirm the eligible
set.

Default merged-cleanup (no `--abandon`) is unchanged.

## Decisions

- Optional positional on `cleanup --abandon`, not a new subcommand — rules out `jarvis1 triage <worktree-name> --abandon` and a separate retire command.
- Omitting the positional keeps the existing global scan — rules out requiring a name on every abandon invocation.
- Scoped eligibility shares PR/merged/draft/multi rules with global abandon through a scoped helper (refactor or wrapper), not a direct `isEligibleForAbandon` call — rules out stdout `skipping …` skip-and-continue for a named target.
- Retire step stays on `retireAbandonedWorktree` — rules out a parallel retire implementation with different PR/branch semantics.
- Scoped mode refuses ineligible named targets with stderr + non-zero exit — rules out global-mode skip-and-continue when the operator named one tree.
- Scoped dry-run lists only the named target — rules out previewing unrelated abandoned worktrees.
- Scoped preview on stdout: header `Worktree to remove:` then one line `<worktree-path> (<branch>)` with optional `(plan)` when the branch is `plan/*` — rules out reusing global `Worktrees to remove:` branch-only listing.
- Guard refusals on stderr; preview on stdout — rules out mixing guard text into preview output.
- Scoped confirmation inherits global `[y/N]`, `cancelled` on decline, exit `0`, no side effects — rules out a different confirm/cancel contract; deferral limited to prompt copy before `[y/N]`.
- Live-lock guard uses exported/shared `readLiveWorktreeLock` semantics on `.worktree/<worktree-name>/.jarvis.lock` (alive PID blocks, stale ignored) — rules out duplicating lock probe logic and rules out refusing on stale lock files.
- Lock refusal reuses patch lock wording (`worktree is in use by process <pid> (started at <timestamp>)`) and exit `9` — rules out inventing a new error shape or exit class.
- Other scoped refusal cases exit `1` — rules out treating guard failures as successful no-ops.
- Scoped retire-step failure exits `1` with `failed to remove <branch>: <message>` — rules out swallowing remove errors for a named target.
- Unknown worktree stderr `unknown worktree: <name>` — rules out cleanup-specific unknown wording.
- Merged PR stderr `cannot abandon <worktree-name>: branch <branch> PR is merged` — rules out global silent merged ineligibility.
- Ready/non-draft PR stderr `unsafe PR state for branch <branch>: matching open PR #<n> is not draft` — rules out global stdout `skipping …: open ready PR`.
- Multiple open PRs stderr `unsafe PR state for branch <branch>: multiple open PRs match; refusing abandon` — rules out global stdout skip line.
- PR inspection failure stderr `failed to inspect PR state for branch <branch>: <message>` — rules out global stdout `skipping …: failed to inspect PRs`.
- Branch resolution failure stderr `cannot abandon <worktree-name>: could not determine branch` — rules out global stdout skip-and-continue.
- Extra positionals with `--abandon` → usage error — rules out silently ignoring trailing args.
- Deferred to first consumer: scoped confirmation prompt copy before `[y/N]` — pin when CLI UX is drafted.
- Deferred to first consumer: behavior when `<worktree-name>` is passed without `--abandon` — pin when CLI parsing is drafted.

## Tasks

- [ ] Parse optional `<worktree-name>` on `cleanup --abandon` in `v1/src/cli.ts` (flag-order independent, extra positionals → usage error); thread through to `cleanupCommand`.
- [ ] Extract scoped abandon eligibility (shared PR/merged/draft/multi rules; stderr fail-fast) and refactor `isEligibleForAbandon` to use it for global scan.
- [ ] Export or share `readLiveWorktreeLock` for cleanup scoped lock guard.
- [ ] Add scoped abandon path in `v1/src/commands/cleanup.ts` (resolve one worktree, lock guard, refuse vs preview vs retire).
- [ ] Tests in `v1/test/cleanup-command.sandbox-unrunnable.test.ts` for scoped retire, guards, dry-run, preview, cancel, retire failure, and global preservation.
- [ ] Tests in `v1/test/cli.sandbox-unrunnable.test.ts` for scoped parse (name + `--abandon`, flag order, extra positional usage error).
- [ ] Update `cleanup` usage/help in `v1/src/cli.ts`.
- [ ] Update `v2/docs/v1-behaviors.md` cleanup entry.

## Acceptance criteria

- [ ] `jarvis1 cleanup --abandon <worktree-name>` retires only the named eligible worktree: closes at most one matching draft PR best-effort, force-removes the worktree, deletes local and remote branch, and leaves the source spec directory on disk unmodified.
- [ ] Scoped abandon prints stdout preview `Worktree to remove:` then `<worktree-path> (<branch>)` (with `(plan)` when applicable) before the confirmation prompt or before exiting on `--dry-run`.
- [ ] Unknown `<worktree-name>` (missing `.worktree/<name>/`) refuses stderr `unknown worktree: <name>`, exits `1`, and makes no changes.
- [ ] Named target whose branch PR is merged refuses stderr `cannot abandon <worktree-name>: branch <branch> PR is merged`, exits `1`, and makes no changes.
- [ ] Named target with an open ready/non-draft PR refuses stderr `unsafe PR state for branch <branch>: matching open PR #<n> is not draft`, exits `1`, and makes no changes.
- [ ] Named target with multiple open matching PRs refuses stderr `unsafe PR state for branch <branch>: multiple open PRs match; refusing abandon`, exits `1`, and makes no changes.
- [ ] Named target when `findMatchingOpenPrs` inspection fails refuses stderr `failed to inspect PR state for branch <branch>: <message>`, exits `1`, and makes no changes.
- [ ] Named target when `.worktree/<name>/` exists but branch cannot be determined refuses stderr `cannot abandon <worktree-name>: could not determine branch`, exits `1`, and makes no changes.
- [ ] Named target with a live `.jarvis.lock` refuses stderr `worktree is in use by process <pid> (started at <timestamp>)`, exits `9`, and makes no changes.
- [ ] Named target with only a stale `.jarvis.lock` (dead PID) is not blocked from scoped abandon.
- [ ] `jarvis1 cleanup --abandon --dry-run <worktree-name>` (and equivalent flag order) previews only the named target (no unrelated worktrees listed), suppresses confirmation, and makes no changes.
- [ ] Declining scoped confirmation prints `cancelled`, exits `0`, and makes no changes (`cleanup-command.sandbox-unrunnable.test.ts` `abandon cancel leaves worktree and branches untouched` pattern).
- [ ] Scoped retire-step failure (e.g. worktree remove throws) prints stderr `failed to remove <branch>: <message>`, exits `1`, and leaves prior side effects as global `hadFailures` semantics dictate.
- [ ] `jarvis1 cleanup --abandon` without `<worktree-name>` behavior is unchanged (`cleanup-command.sandbox-unrunnable.test.ts` global abandon tests stay green).
- [ ] `jarvis1 cleanup --abandon <worktree-name>` and `jarvis1 cleanup <worktree-name> --abandon` parse equivalently; extra positionals exit with usage error.
- [ ] `cleanup` help/usage documents optional `[<worktree-name>]` with `--abandon`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — scoped abandon surface, refusal guards, preview format, dry-run scoping, and global-mode preservation.
- `v1/src/cli.ts` — `cleanup` usage/help for optional `[<worktree-name>]` with `--abandon`.
