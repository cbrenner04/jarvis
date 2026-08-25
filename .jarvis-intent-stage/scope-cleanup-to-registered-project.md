---
name: scope-cleanup-to-registered-project
---

# Scope cleanup to one registered project

Unsplit rationale: The positional argument, registry validation, scoped discovery, help, and operator contract are one independently observable CLI behavior.

## Primary implementation surface

CLI admission and cleanup command orchestration

## Prerequisites

## Problem

`jarvis cleanup` surveys every registered project's managed worktrees, merged branch refs, and open spec home, so a session-close cleanup can inspect or mutate another concurrently active project.

## Decisions

- Accept `jarvis cleanup [<project>]`; rules out a `--project` flag because cleanup follows the CLI's verb-and-target grammar.
- Validate a supplied project against the registry before daemon discovery, cleanup survey, or mutation; rules out silently cleaning nothing or falling back to all projects.
- Filter the registry once for every project-owned cleanup slice, including managed-worktree retirement, merged-branch ref pruning, and stranded-spec archival; rules out leaving another project's ref pruning active while claiming that project is untouched.
- Keep dead daemon-socket reaping global because sockets are not project-owned; rules out inventing a project-to-socket ownership contract.
- Keep bare `jarvis cleanup` on the current all-registered-projects path; rules out making the project required or changing the default.
- Apply the same project scope under `--dry-run` and `--yes`; rules out preview/apply divergence.
- Keep `--abandon <name>` as the existing single-workspace path, outside project-scoped bulk cleanup; rules out changing abandon selection semantics.
- Preserve every existing eligibility and archival ownership recheck after scoping; rules out treating a named project as authorization to weaken safety gates.

## Acceptance criteria

- [ ] With two registered projects, `jarvis cleanup <project>` surveys and considers only the selected project's managed worktrees, merged branch refs, and open spec home; the other project's project-owned discovery and mutation seams are never called.
- [ ] Bare `jarvis cleanup` still surveys every registered project.
- [ ] `jarvis cleanup <unknown-project>` exits non-zero, names the unknown key, and performs no daemon discovery, cleanup survey, or mutation.
- [ ] The positional project composes with `--dry-run`, `--yes`, and `-y`, while `--abandon <name>` keeps its existing behavior.
- [ ] Scoped preview and apply preserve existing worktree, ref-prune, stranded-archive, and ownership rechecks.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Update cleanup usage/help to show `jarvis cleanup [<project>]` and its flags.
- Update `v2/docs/operator-runbook.md` to prefer named-project cleanup for concurrent session close, describe unknown-project refusal, and distinguish project-owned cleanup from global socket reaping.
- Update `v2/docs/v1-behaviors.md` with the changed v2 cleanup scope contract.
