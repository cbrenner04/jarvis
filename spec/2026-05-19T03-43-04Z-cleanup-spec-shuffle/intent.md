---
name: cleanup-spec-shuffle
---

"spec shuffle",  as i like to call it, needs to be part of the cleanup action

this is just committing the change of spec directory from spec/ to spec/completed/

## Refine turn 1

The repo already has `jarvis cleanup` support for moving `spec/<name>/` into `spec/completed/<name>/`, but the current mapping is based on the branch/worktree basename. That works for legacy `spec/<plan-name>/` trees and patch-mode specs, but it intentionally misses newer timestamped plan specs such as `spec/2026-05-17T22-14-03Z-<plan-name>/`, which the docs currently call out as a manual cleanup case.

Scope this draft around making cleanup perform that archive move automatically for the spec directory associated with the merged worktree being removed, instead of only for the flattened `<plan-name>` path. Preserve the existing cleanup gates and behavior first: only merged worktrees qualify, dirty/unpushed worktrees are skipped, `--dry-run` stays non-mutating, and archive failures should remain descriptive rather than silently deleting specs.

Keep the change bounded to in-repo `commit: true` specs under `spec/`; do not broaden it into external `~/.jarvis/specs/...` cleanup or unrelated worktree lifecycle changes. The draft should also account for collision/ambiguity handling when the destination under `spec/completed/` already exists, and should update docs/tests to match the new automatic timestamped-spec archive behavior.

## Refine turn 2

Keep the draft centered on source-path resolution, not on redesigning cleanup. The current implementation in `src/commands/cleanup.ts` already removes the worktree/branch first, then archives from `spec/<archive>/` into `spec/completed/<archive>/`, with non-fatal missing-source handling and accumulated archive failures. The intended change is to make the archive source for merged plan worktrees point at the actual spec directory under `spec/` when that directory uses the newer timestamped basename, while preserving the existing post-removal ordering and failure model.

Bound the lookup rule tightly. Patch-mode worktrees should keep their current direct mapping to `spec/<branch>/`. For plan-mode worktrees, cleanup should still derive the logical plan name from `plan/<name>`, but then resolve the in-repo source directory as the single matching direct child of `spec/` whose basename is either exactly `<name>` or a timestamp-prefixed `<timestamp>-<name>` in the format already documented by plan mode. Reuse existing timestamp-prefix parsing rules if practical so cleanup and resume do not drift on what counts as a valid prefixed spec directory.

Do not let cleanup guess when multiple in-repo candidates map to the same logical `<name>`. If both `spec/<name>/` and one or more `spec/<timestamp>-<name>/` directories exist, or if multiple timestamped directories collapse to the same plan name, the draft should require a descriptive archive failure that leaves all candidate sources in place after the successful worktree/branch removal. That is a different case from the existing destination-collision check under `spec/completed/`, but it should follow the same operational posture: report the ambiguity clearly, continue processing other removable worktrees, and return non-zero at the end.

The docs currently say timestamped plan specs must be moved manually after cleanup, so the draft should explicitly replace that guidance with the new automatic behavior and preserve the carve-out for external `commit: false` specs. Test coverage should grow beyond the existing legacy `spec/<name>/` plan-path case to cover at least: automatic archival of a single timestamped plan spec, ambiguity when multiple matching sources exist, continued support for untimestamped legacy plan specs, and `--dry-run` remaining non-mutating even when a timestamped match is present.

## Refine turn 3

There is already a canonical timestamp-prefix parser in `src/modes/plan/spec-paths.ts`: `stripPlanSpecTimestampPrefix()` backed by `TIMESTAMPED_SPEC_DIR_RE`. The draft should explicitly steer implementation toward reusing that helper, or a shared helper extracted from the same module if cleanup cannot import it directly, so plan resume and cleanup keep one definition of what counts as `YYYY-MM-DDTHH-mm-ssZ-<name>`.

Keep the filesystem search narrow and mechanical. For merged `plan/<name>` worktrees, cleanup should inspect only direct children of the repo-local `spec/` directory and only consider directory basenames that collapse to `<name>` under that existing parser. It should not recurse, and it should not treat `spec/completed/` contents as candidates for source resolution. A useful framing for the draft is: resolve zero matches as the current non-fatal “no spec directory moved” case, resolve exactly one match as the source to archive, and resolve more than one match as an ambiguity failure that is reported after the worktree/branch removal succeeds.

Destination naming should follow the resolved source basename, not the flattened logical plan name. If cleanup archives `spec/2026-05-17T22-14-03Z-foo/`, the destination should be `spec/completed/2026-05-17T22-14-03Z-foo/`; legacy `spec/foo/` should still land at `spec/completed/foo/`. That preserves the spec tree identity, avoids silently discarding the timestamp, and keeps the existing destination-collision guard meaningful on the actual archived path.
