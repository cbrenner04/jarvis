# 00 - Resolve in-repo cleanup archive sources

`jarvis cleanup` already does the right high-level sequence for merged worktrees:
it enforces the existing merged/clean/pushed gates, removes the worktree and
branch, then tries to archive an in-repo spec directory from `spec/...` into
`spec/completed/...`. The gap is that plan worktrees still flatten
`plan/<name>` to `spec/<name>/`, so cleanup misses newer committed plan specs
that live under `spec/YYYY-MM-DDTHH-mm-ssZ-<name>/`.

Keep this slice tightly scoped to source-path resolution for in-repo `commit:
true` specs. Patch-mode worktrees should keep their current direct mapping.
Plan-mode worktrees should still derive the logical plan name from `plan/<name>`,
then resolve the archive source by scanning only the direct children of the
repo-local `spec/` directory and selecting the single directory whose basename
collapses to `<name>` under the canonical plan timestamp parser. Zero matches
should remain the current non-fatal "no spec directory moved" case. More than
one match should become a descriptive ambiguity failure that leaves all source
directories in place after the worktree/branch removal succeeds.

Destination naming should preserve the resolved source basename. If cleanup
archives `spec/2026-05-17T22-14-03Z-foo/`, the destination should be
`spec/completed/2026-05-17T22-14-03Z-foo/`; legacy `spec/foo/` should still land
at `spec/completed/foo/`.

Non-goals for this slice: do not change cleanup's merged/clean/pushed gates,
do not change its post-removal archive ordering, do not broaden cleanup to
external `commit: false` specs, and do not redesign patch-mode naming.

## Task checklist

- [ ] Reuse `stripPlanSpecTimestampPrefix()` from `src/modes/plan/spec-paths.ts`,
      or extract a shared helper from that module if `src/commands/cleanup.ts`
      cannot import it directly, so cleanup and plan resume share one definition
      of a valid `YYYY-MM-DDTHH-mm-ssZ-<name>` directory.
- [ ] Keep patch-mode archive resolution unchanged: archive `spec/<branch>/`
      into `spec/completed/<branch>/` after a successful cleanup removal.
- [ ] For merged plan worktrees, inspect only direct children of the repo-local
      `spec/` directory, ignore `spec/completed/` as a source candidate, and
      consider only directory basenames that collapse to the logical plan name
      under the shared timestamp-prefix parser.
- [ ] Preserve the existing cleanup ordering and failure posture: remove the
      worktree/branch first, treat zero source matches as non-fatal, accumulate
      archive failures without aborting later removals, and return non-zero only
      after processing the full queue.
- [ ] Preserve the current destination-collision behavior on the resolved
      source basename rather than on the flattened logical plan name, so
      `spec/completed/<resolved-basename>/` remains the only archive target
      checked for collisions.
- [ ] Add regression coverage in `test/cleanup-command.test.ts` for:
      one timestamped plan spec being archived automatically, multiple matching
      source candidates producing an ambiguity failure while leaving sources in
      place, legacy untimestamped `spec/<name>/` plan specs continuing to work,
      and `--dry-run` remaining non-mutating when a timestamped match exists.

## Acceptance criteria

- [ ] After a confirmed merged cleanup of `.worktree/plan-<name>/`, if exactly
      one direct child of `spec/` is a directory whose basename collapses to
      `<name>` under the shared timestamp-prefix parser, cleanup archives that
      exact directory into `spec/completed/<same-basename>/`.
- [ ] Patch-mode cleanup behavior is unchanged: non-plan branches still archive
      from `spec/<branch>/` into `spec/completed/<branch>/`.
- [ ] For merged plan worktrees, cleanup does not recurse through `spec/`, does
      not treat `spec/completed/` contents as source candidates, and treats zero
      matches as the existing non-fatal "no spec directory moved" outcome.
- [ ] If more than one direct child of `spec/` maps to the same logical plan
      name, cleanup reports a descriptive ambiguity failure after the worktree
      and branch are removed, leaves every candidate source in place, continues
      processing other removable worktrees, and exits non-zero at the end.
- [ ] Existing destination-collision handling remains based on the resolved
      source basename, so a timestamped source collides only with the matching
      timestamped destination path under `spec/completed/`.
- [ ] `test/cleanup-command.test.ts` covers automatic archival of a single
      timestamped plan spec, ambiguity with multiple matching sources, continued
      support for legacy untimestamped plan specs, and `--dry-run` staying
      non-mutating when a timestamped match exists.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- [ ] Add or refresh only the minimal inline comments/docstrings needed to keep
      the cleanup source-resolution rule understandable in code; user-facing
      cleanup documentation lands in `01-document-automatic-timestamped-spec-archival.md`.
