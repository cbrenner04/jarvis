# Retire commit:false specs from the external home

## Problem

`jarvis1 cleanup` removes merged worktrees, then archives each completed spec
to `<home>/completed/`. It only resolves specs under in-repo homes
(`resolveSpecArchiveSource` in `v1/src/commands/cleanup.ts` searches
`targetDir`, `v1/spec`, `v2/spec`). For a `commit: false` project the spec
lives in the external home `~/.jarvis/specs/<proj>/<name>/`, never in-repo, so
cleanup prints `no spec directory moved ... missing <repo>/spec/<name>` and
strands the external dir plus its consumed `ready-intents/<name>.md`. The
operator must hand-`mv` the dir into `completed/` and delete the ready-intent.

Same root cause as #529: cleanup assumes the in-repo location. Intake #566.

## Behavior

When the resolved project's effective `plan.commit` is `false`, cleanup
retires each merged worktree's spec from the external home instead of in-repo:

- Source: `~/.jarvis/specs/<project-safe-id>/<spec-dir>/`, resolved via the same
  `computeProjectSafeId` path that `intent`/`plan` use (`v1/src/modes/plan/spec-paths.ts`).
  The `<spec-dir>` is the worktree branch name (run worktrees branch on the spec
  dir basename, so the timestamped basename matches exactly).
- Destination: `~/.jarvis/specs/<project-safe-id>/completed/<spec-dir>/`.
- Archiving is a filesystem move only — no `git add`/`commit`/`push` (external-home
  artifacts are not tracked in the target repo).
- Prune the consumed ready-intent `~/.jarvis/specs/<project-safe-id>/ready-intents/<name>.md`,
  where `<name>` is the spec-dir basename with any timestamp prefix stripped
  (`stripPlanSpecTimestampPrefix`). A missing ready-intent is not an error.

In-repo (`commit: true`) cleanup is unchanged: it still searches in-repo homes
and git-tracks the archive move.

## Decisions

- Branch on the project's effective `plan.commit` (resolved in `v1/src/cli.ts`
  cleanup case via `resolvePlanFlags`, already loaded there for `targetDir`) — not on
  whether an in-repo source happens to be missing; the missing-source diagnostic must
  stay meaningful for genuinely-absent in-repo specs. Rules out silently falling
  through to the external home for `commit: true`.
- External archive is move-only; do not call `commitArchivedSpecMove`. Rules out
  attempting a git commit in a home outside the target repo (would fail or pollute history).
- A missing external ready-intent prunes to a no-op, not a failure — a spec may be
  run from a hand-written external spec with no `ready-intents/` entry. Rules out
  marking `hadFailures` when there is nothing to prune.
- An already-existing `completed/<spec-dir>` destination leaves the source in place
  and reports failure, matching the existing in-repo guard. Rules out clobbering a
  prior archive.

## Task checklist

- [ ] Pass the resolved project (`ProjectMatch`) and effective `commit` flag into
  `cleanupCommand` from the CLI cleanup case.
- [ ] When `commit === false`, resolve source/destination/ready-intent under the
  external home via `computeProjectSafeId`/`computeNoCommitSpecRoot` and the config dir;
  skip the in-repo home search.
- [ ] Perform external archiving as a filesystem move with no git operations; prune
  the consumed ready-intent (no-op if absent).
- [ ] Tests cover: commit:false external archive move + ready-intent prune, no git
  invoked; missing external source reports the external path; existing external
  destination left-in-place; missing ready-intent prunes to no-op; commit:true path
  unchanged.

## Acceptance criteria

- [ ] For a `commit: false` project, `jarvis1 cleanup` archives a merged spec's
  external dir from `~/.jarvis/specs/<proj>/<name>/` to
  `~/.jarvis/specs/<proj>/completed/<name>/`.
- [ ] For a `commit: false` project, cleanup prunes the consumed
  `~/.jarvis/specs/<proj>/ready-intents/<stripped-name>.md` for the retired spec.
- [ ] `commit: false` archiving runs no `git add`/`commit`/`push` against the target repo.
- [ ] A missing external ready-intent during `commit: false` cleanup is a no-op, not a failure.
- [ ] An existing `~/.jarvis/specs/<proj>/completed/<name>/` leaves the source in place
  and cleanup reports failure.
- [ ] When the external source dir is absent, the missing-source message names the
  external `~/.jarvis/specs/<proj>/<name>` path, not the in-repo `spec/` path.
- [ ] In-repo (`commit: true`) cleanup behavior is unchanged: existing `cleanup.ts`
  in-repo archive + git-commit tests stay green.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md` — extend the `cleanup` archiving entry: under
  `commit: false`, cleanup archives the spec from the external home
  `~/.jarvis/specs/<proj>/` to that home's `completed/` (move-only, no git) and prunes
  the consumed external `ready-intents/<name>.md`.
- [ ] `v1/docs/operator-runbook.md` — note that `jarvis1 cleanup` archives `commit: false`
  specs from the external home (no manual `mv`/prune needed).
