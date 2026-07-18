# Drill into either worktree home by name

## Problem

`jarvis1 triage <name>` diagnostic drill-down resolves `<name>` only in the v1
home (`<repo>/.worktree/`). A worktree living in the registered project's
Jarvis-owned v2 home (`<config.dir|~/.jarvis>/worktrees/<project.key>/`) is
invisible to drill-down and reports `unknown worktree`, even though no-arg
listing and `--merge` already resolve both homes. Make drill-down resolve
`<name>` across both homes and render the existing diagnostic sections for
whichever home it lives in.

## Decisions

- Resolve `<name>` across both homes with one shared resolver; rules out a
  separate v2-only drill-down command.
- Refuse a name present in both homes, reporting both matching paths; rules out
  silently picking one by search order.
- Scope to diagnostic drill-down only; `--mark-ready` two-home resolution is out
  of scope.

## Task checklist

- Resolve the drill-down `<name>` against both homes (reuse the v2-home
  computation already used by listing/`--merge`: `findProjectMatchForPath` +
  `join(config?.dir ?? CONFIG_DIR, "worktrees", project.key)`).
- Drill into the sole matching home; refuse cross-home ambiguity with both
  paths; keep the `unknown worktree` error when neither home matches.
- Add a test drilling into a v2-home-only worktree and a test for cross-home
  ambiguity refusal.
- Update `v1/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `jarvis1 triage <name>` renders the existing diagnostic sections for a
  worktree that exists only in the registered project's Jarvis-owned v2 home.
- [x] A `<name>` present in both the v1 home and the v2 home is refused, and the
  error names both matching paths instead of drilling into one.
- [x] A `<name>` present in neither home still fails with the existing
  `unknown worktree` error.
- [x] A test drives drill-down into a v2-home-only worktree (asserting the
  diagnostic section output) and a test asserts cross-home ambiguity refusal;
  both fail against the pre-fix v1-home-only drill-down and pass after the
  change.
- [x] `v1/docs/operator-runbook.md` records that drill-down resolves both homes
  and refuses cross-home ambiguity.
- [x] `v2/docs/v1-behaviors.md` records named drill-down resolution across both
  homes and its ambiguity refusal, superseding the stale "drill-down remains
  v1-home-only" note.
