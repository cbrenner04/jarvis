# Plan spec-path merge-target resolution

## Problem

`jarvis1 triage <timestamped-plan-spec>/index.md --merge` fails with no backing worktree: the spec directory basename does not match `.worktree/plan-<name>/`, and plan worktrees have no `.active-spec-path` marker.

## Decisions

- Extend `resolveMergeTarget` / `resolveWorktreeFromSpecPath` — rules out a triage-only parallel lookup.
- Reuse `stripPlanSpecTimestampPrefix` from `v1/src/modes/plan/spec-paths.ts` — rules out a duplicate timestamp regex in the resolver.
- When the input has a path separator, union a third candidate: `.worktree/plan-<slug>` where `<slug>` is `stripPlanSpecTimestampPrefix(specDirBasename)` — rules out requiring `.active-spec-path` on plan worktrees for spec-path entry.
- Keep existing basename and marker-scan strategies unchanged — rules out regressing patch spec-path resolution.
- Marker match and plan-slug match dedupe into the same candidate set; zero or multiple distinct worktrees still refuse before gate or merge — rules out picking an arbitrary plan worktree.
- Scope is `--merge` target resolution only; `--mark-ready` and read-only triage stay worktree-name-only — rules out widening finalize/drill-down entry points named in the prerequisite spec.
- Deferred to first consumer: bare `.md` filename resolving a timestamped plan spec without a marker — pin when an operator asks.

## Task checklist

- Add plan-slug worktree lookup to `resolveWorktreeFromSpecPath` in `v1/src/commands/resolve-merge-target.ts`.
- Tests in `v1/test/triage-command.test.ts`: markerless timestamped plan spec path resolves and merges; existing marker-based plan case stays green; patch basename/marker/ambiguity/zero-match cases stay green.
- Update `v2/docs/v1-behaviors.md` `triage --merge` spec-path resolution (plan worktrees match timestamp-stripped spec-dir slug without a marker).

## Acceptance criteria

- [ ] `jarvis1 triage v1/spec/<timestamp>-<plan-name>/index.md --merge` resolves to `.worktree/plan-<plan-name>/` without `.active-spec-path` and admin-squash-merges when gates pass.
- [ ] `jarvis1 triage <plan-spec-path> --merge` still resolves plan worktrees when `.active-spec-path` points at that spec path.
- [ ] `triage-command.test.ts` merge-target resolution tests for patch spec paths (basename, marker, bare `.md`, zero-match, ambiguity, PR ref) stay green.
- [ ] Unresolvable or ambiguous plan spec paths exit non-zero with the existing merge-target stderr shapes and perform no merge side effects.

## Documentation updates

- `v2/docs/v1-behaviors.md`: `triage --merge` spec-path resolution includes timestamp-stripped plan spec directories mapping to `.worktree/plan-<name>/` without a marker; marker match remains valid.
