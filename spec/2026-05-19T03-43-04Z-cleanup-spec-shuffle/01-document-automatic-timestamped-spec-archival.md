# 01 - Document automatic timestamped spec archival

The current docs explicitly say that `jarvis cleanup` archives
`spec/<plan-name>/` automatically but leaves newer timestamped committed plan
specs under `spec/YYYY-MM-DDTHH-mm-ssZ-<plan-name>/` for manual cleanup. That
guidance should be replaced once cleanup resolves the real in-repo source
directory for merged `plan/<name>` worktrees.

This slice is documentation-only. Keep the scope aligned with the implementation
contract from subspec 00: cleanup still handles only in-repo `commit: true`
specs under `spec/`, still archives after successful worktree/branch removal,
still leaves missing sources as non-fatal, and still does not touch external
Jarvis-owned `commit: false` specs under `~/.jarvis/specs/...`.

## Task checklist

- [ ] Update `docs/plan-mode.md` so the cleanup section describes automatic
      archival of a single matching timestamped committed plan spec, preserves
      the carve-out for external `commit: false` specs, and removes the current
      "move timestamped specs manually" guidance.
- [ ] Update `docs/worktrees-and-commits.md` so the authoritative cleanup rules
      describe the plan-mode source-resolution behavior, including zero-match
      non-fatal handling, ambiguity failures when multiple `spec/` children map
      to the same logical plan name, and destination naming based on the
      resolved source basename.
- [ ] Keep the no-commit/external-spec story explicit: `jarvis cleanup` does not
      delete or archive Jarvis-owned specs outside the target repo.
- [ ] Keep examples and terminology aligned with the implementation contract:
      plan worktrees still resolve from logical `plan/<name>`, but archival
      preserves the resolved source basename such as
      `spec/2026-05-17T22-14-03Z-foo/ -> spec/completed/2026-05-17T22-14-03Z-foo/`.

## Acceptance criteria

- [ ] `docs/plan-mode.md` no longer instructs users to manually move committed
      timestamped plan specs into `spec/completed/` after `jarvis cleanup`.
- [ ] `docs/worktrees-and-commits.md` describes the narrow plan-mode lookup
      rule: inspect only direct children of repo-local `spec/`, collapse names
      with the shared timestamp-prefix parser, archive zero matches as a
      non-fatal no-op, and report multi-match ambiguity as a non-fatal-per-item
      failure that still yields a non-zero overall exit.
- [ ] Documentation examples preserve spec-tree identity by showing timestamped
      sources landing at matching timestamped destinations under
      `spec/completed/`.
- [ ] Documentation continues to state that external `commit: false` specs under
      `~/.jarvis/specs/...` are outside `jarvis cleanup`'s archive scope.

## Documentation updates

- [ ] This subspec is the user-facing documentation update for the feature.
