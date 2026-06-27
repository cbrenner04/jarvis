# Archive external commit:false specs on cleanup

## Problem

`jarvis1 cleanup` archives a merged spec only from the in-repo home
(`<repo>/spec/<name>`, `v1/spec`, `v2/spec`). For a project with
`plan.commit === false`, specs live in the external home
`~/.jarvis/specs/<proj>/<name>/`, not in-repo. Cleanup resolves the in-repo path,
finds nothing, prints `no spec directory moved ... missing <repo>/spec/<name>`,
and leaves the external dir behind. The operator then manually `mv`s the dir into
`completed/` and deletes the consumed `ready-intents/<name>.md`.

## Direction

When the cleaned worktree's project is `commit:false`, archive from the external
home instead of in-repo `spec/`:

- move `~/.jarvis/specs/<proj>/<name>/` → `~/.jarvis/specs/<proj>/completed/<name>/`
- prune `~/.jarvis/specs/<proj>/ready-intents/<name>.md` if present

External moves are plain filesystem renames — no `git add`/`commit`/`push` (the
external home is not the target repo). In-repo `commit:true` archival (with its
git commit/push, `commitArchivedSpecMove`) is unchanged.

## Decisions

- Branch on `resolvePlanFlags(cfg, project).commit === false` (a project-wide flag); rules out per-worktree detection.
- Resolve `<proj>` + external home with `computeProjectSafeId(project)` and `opts.config?.dir ?? CONFIG_DIR`, identical to intent/plan; rules out a cleanup-local derivation that could drift from where specs are written.
- The CLI passes the resolved `commit` flag and external specs root into `CleanupCommandOptions` via new fields `commit: boolean` and `externalSpecsRoot?: string` (it already resolves `project` and `cfg` for `targetDir`); rules out re-resolving config inside `cleanupCommand` and lets tests inject these without a config file on disk.
- External archival is a plain `renameSync` with no git staging/commit/push; rules out committing into a home that is not the target repo.
- External spec-dir resolution mirrors in-repo: exact `<externalRoot>/<branch>`, then for a `plan/` branch a timestamp-stripped match (`stripPlanSpecTimestampPrefix`); rules out exact-only matching that misses timestamped external dirs. Non-plan `commit:false` branches archive via exact-match only; timestamp-stripping applies only to `plan/` branches — but the external path is entered for any `commit:false` worktree, not gated on a `plan/` prefix; rules out silently skipping non-plan worktrees.
- The `ready-intents` prune filename is the **branch slug** (e.g. `my-feature.md`), never the archive-source basename. For a timestamp-matched dir the basename is the full timestamped name (`2026-…-my-feature`) while the consumed intent file is `my-feature.md`; rules out pruning the wrong filename and silently leaving the intent behind.
- Prune `ready-intents/<branchSlug>.md` best-effort; a missing file is non-fatal; rules out erroring when the intent was already pruned.
- Reuse the reserved-`completed` name guard and destination-collision guard on the external path; rules out clobbering an existing archive.

## Task checklist

- [ ] Thread `commit` and the external specs root (`~/.jarvis/specs/<proj>/`) into `cleanupCommand` via `CleanupCommandOptions`, derived in the cli cleanup case from the already-resolved `project`/`cfg`.
- [ ] When `commit === false`, resolve the archive source from the external home (exact + plan-branch timestamp-stripped match), move to `completed/`, prune `ready-intents/<branchSlug>.md`, and skip all git operations.
- [ ] Keep the `commit === true` path (in-repo resolution + `commitArchivedSpecMove`) unchanged.
- [ ] Add tests for the external archival path (move, ready-intents prune, missing-source non-fatal, no-git, collision guard).
- [ ] Update docs: cleanup reference, operator runbook, `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] For a `commit:false` project, cleaning a merged worktree moves its external spec dir `~/.jarvis/specs/<proj>/<name>/` to `~/.jarvis/specs/<proj>/completed/<name>/`.
- [x] For a `commit:false` project, the consumed `~/.jarvis/specs/<proj>/ready-intents/<branchSlug>.md` (the branch slug, e.g. `my-feature.md`, not the timestamped archive-source basename) is removed when present; its absence does not fail cleanup.
- [x] A timestamped external spec dir is matched from a `plan/<slug>` branch via the timestamp-stripped slug and lands in the external `completed/`, and its `ready-intents/<slug>.md` is pruned by branch slug.
- [x] For a `commit:false` project on a non-plan branch, an exact-match external spec dir `~/.jarvis/specs/<proj>/<branch>/` archives to `completed/<branch>/` (the external path is not gated on a `plan/` prefix).
- [x] External archival performs no `git add`/`commit`/`push`; it succeeds even when the external home is not a git repository.
- [x] For a `commit:false` project, a missing external spec dir is non-fatal and prints a `no spec directory moved ... missing <external-path>` message naming the external path.
- [x] For a `commit:false` project, an existing destination under external `completed/` leaves the source in place and reports failure (cleanup exit 1).
- [x] `cleanup-command.sandbox-unrunnable.test.ts` in-repo archival tests stay green (commit:true path with git commit/push unchanged).
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/config.md` cleanup reference (or `v1/docs/plan-mode.md`'s cleanup note): document that under `commit:false`, cleanup archives from the external home `~/.jarvis/specs/<proj>/<name>/` to its `completed/` and prunes `ready-intents/<name>.md`, with no git commit. Correct the existing plan-mode line stating cleanup "does not delete Jarvis-owned external specs."
- `v1/docs/operator-runbook.md` end-of-session cleanup: drop the manual `mv`/prune note for `commit:false` specs now that cleanup handles it.
- `v2/docs/v1-behaviors.md`: record the `commit:false` external-home archival + `ready-intents` prune behavior (a change to existing cleanup functionality).
