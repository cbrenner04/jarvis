---
name: cleanup-scopes-to-a-named-project
---

# `jarvis cleanup` takes a project param to scope worktree retirement and stranded-spec scanning to one registered project

## Problem

`jarvis cleanup` always operates across **every** registered project: `discoverWorktrees` (`v2/src/commands/cleanup.ts:51`) iterates `Object.keys(registry)`, and stranded-spec scanning walks each registered project's spec home. There is no way to say "only clean up `jarvis`." When more than one project is registered — routinely true when the operator is also dogfooding a target repo (e.g. `chess-mvp-yolo`) in the same or a concurrent session — a cleanup meant for one project surveys and can retire worktrees / archive specs belonging to another.

This is the concurrent-session hazard already called out in the operator runbook (scope cleanup to your own specs, tear down only your own worktrees): today the operator has to eyeball the dry-run and hand-retire, because the command itself cannot be narrowed. A project param makes the safe path the easy path.

Observed 2026-08-24: operator session driving `jarvis` work with a live `chess-mvp-yolo` dogfood registered; a session-close `jarvis cleanup` would survey both projects' worktrees with no way to limit it to `jarvis`.

## Decisions

- Accept an optional positional project argument: `jarvis cleanup [<project>]`. When given, worktree discovery and stranded-spec scanning are restricted to that one registered project; every other project is untouched. Rules out a `--project` flag (the positional form matches the CLI's verb-and-target grammar).
- Bare `jarvis cleanup` (no project) keeps today's all-registered-projects behavior unchanged. Rules out making the param required or changing the default.
- An unknown project name (not in the registry) exits non-zero with a message naming the unknown key before any survey or mutation. Rules out silently cleaning nothing or falling back to all-projects.
- The param composes with `--dry-run` and `--yes`; scoping applies identically to preview and apply. `--abandon <name>` already targets a single workspace and is unaffected (project scoping is for the whole-registry survey path). Rules out interaction surprises.
- Stranded-spec archival stays gated on the same ownership rechecks; scoping only narrows which project(s) are surveyed, never loosens the archival safety checks. Rules out scope becoming a way to over-archive.

## Acceptance criteria

- [ ] `jarvis cleanup <project>` discovers and considers worktrees only under that project's `~/.jarvis/worktrees/<project>/` tree, and scans only that project's spec home for stranded specs — pinned by a test with two registered projects asserting the other project's worktrees/specs are never surveyed (fails against the current all-registry iteration).
- [ ] Bare `jarvis cleanup` (no project arg) still surveys every registered project — pinned by a test.
- [ ] `jarvis cleanup <unknown-project>` exits non-zero naming the unknown project before any worktree survey or archival — pinned by a test.
- [ ] The project param composes with `--dry-run` (preview scoped, no mutation) and `--yes` (apply scoped) — pinned by CLI-parse tests.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — cleanup section and the concurrent-session guidance: prefer `jarvis cleanup <project>` to scope a session-close cleanup to your own project; note the unknown-project refusal.
- Cleanup CLI usage/help text — document the optional positional project argument.
