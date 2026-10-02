# Staged cleanup archive branch recovery

## Problem

Per-spec archive skips when `cleanupBranchCarryingArchive` finds the move already on a local `cleanup/archive-*` branch, and stranded inspection uses the same skip without recording that branch for publication. Later cleanups keep failing with `already staged on cleanup branch …; push it and open the archive PR` even though the operator never got an automated push/PR.

## Decisions

- Per-spec `already staged on cleanup branch …` skips remain during the archive loop — rules out mid-loop `publishArchiveReady` on each skip.
- Apply end consults a per-project publication target set: any session with `commits() > 0` this run plus any `cleanup/archive-*` branch discovered for a staged skip or stranded inspection in that project — rules out losing staged-only branches that produced zero new session commits.
- Staged-only recovery resolves the branch's managed worktree path under `~/.jarvis/worktrees/<project>/` when present — rules out losing the push cwd when the session worktree still exists.
- Deferred to first consumer: push cwd for staged branches with no managed worktree — pin when a fixture surfaces.
- `createArchivePublicationSession` / `createArchivePublicationSessions` accept an optional adopted `branch` (and worktree) so a run that only recovers publication does not create a second `cleanup/archive-<new-stamp>` — rules out duplicate archive branches for the same staged content.
- Deferred to first consumer: tie-break when multiple local `cleanup/archive-*` branches carry overlapping staged trees — pin when a fixture or production case surfaces multiples.

## Task checklist

- [ ] Record staged cleanup branch names per project when `publish` or stranded inspection skips for `already staged on cleanup branch …`.
- [ ] Expose apply-end publication targets (session branches plus recorded staged branches) to `cleanup.ts` without duplicating `cleanupBranchCarryingArchive` scans.
- [ ] Allow archive session factory to adopt an existing `cleanup/archive-*` branch and worktree instead of always minting a new stamp.
- [ ] Add or extend tests in `cleanup-archive-publication.test.ts` for target registration and branch adoption seams.

## Acceptance criteria

- [ ] `cleanup-archive-publication.test.ts`: when archive `publish` or stranded inspection skips with `already staged on cleanup branch`, the per-project publication target set includes that `cleanup/archive-*` branch (and worktree path when the managed worktree exists); fails against pre-fix skip-only behavior with no target registration (reachable on main: `cleanup-archive-publication.ts` `publish` return at staged skip; `inspectSpecArtifact` skip in `cleanup.ts`).
- [ ] The same file: on a recovery-only apply (staged skip, no new archive commit this run), apply-end publication uses that existing `cleanup/archive-*` branch name and does not create a second stamped archive branch; fails against pre-fix behavior that mints a new session branch when `commits() === 0`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — staged cleanup archive branch recovery on the next apply (publication wiring in subspec 01 completes operator-facing push/PR).
