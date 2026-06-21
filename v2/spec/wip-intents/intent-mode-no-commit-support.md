# `intent` mode can't run under `commit: false`

## Problem

`jarvis intent` always commits and opens a PR, so it errors under a `commit: false` config and
can't be used in an isolated, fully-local setup (the `git: false` + `commit: false` worktree
workflow that the `run` loop already supports). The operator bypassed it by authoring
ready-intents/specs by hand — fine, but it means a whole mode is unavailable in the exact
isolated configuration that otherwise works end-to-end.

## Direction

Either support a no-commit intent path (write the intent artifact to the external no-commit
location, mirroring the no-commit plan/run design) or, if that's out of scope, fail fast at
config/preflight with a clear message documenting the constraint instead of erroring deep in the
commit step. Prefer the former for parity with `run`.

## Out of scope

- The `run`/`plan` no-commit paths — already handled; this aligns `intent` with them.

## Documentation updates

- `v2/docs/v1-behaviors.md` and the intent-mode docs — record the no-commit behavior or the
  documented constraint.

## References

- groceries `redesign-fixups-report.md` §5.5 — source.
- The no-commit external-spec design `intent` should mirror:
  `v1/spec/completed/2026-06-18T16-47-07Z-no-commit-plan-external-spec-write-access/`.
