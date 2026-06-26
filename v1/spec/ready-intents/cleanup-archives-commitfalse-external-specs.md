---
name: cleanup-archives-commitfalse-external-specs
---

# cleanup archives commit:false specs from the external home

## Problem

`jarvis1 cleanup` retires merged worktrees but, for a `commit:false` project,
fails to archive completed specs. It resolves specs under the in-repo
`<repo>/spec/<name>`, but `commit:false` specs live in the external home
`~/.jarvis/specs/<proj>/<name>/`. So worktrees get removed while external spec
dirs are stranded, printing `no spec directory moved ...`, forcing the operator
to hand-`mv` them into `completed/` and prune consumed `ready-intents/`.

Same root cause as #529: cleanup assumes the in-repo location and ignores the
external `commit:false` home. Intake #566.

## Direction

When `commit === false`, cleanup retires a completed spec from its external home:
archive `~/.jarvis/specs/<proj>/<name>/` → `~/.jarvis/specs/<proj>/completed/`
and prune the consumed `ready-intents/<name>.md`, instead of looking under
in-repo `spec/`. Reuse the same external-home path resolution
(`computeNoCommitSpecRoot` / project-safe-id) that `intent`/`plan` already use so
the two stay consistent. External-home archiving is a filesystem move only — no
git add/commit/push (those artifacts are not tracked in the target repo).

## Out of scope

- In-repo (`commit:true`) cleanup behavior — that path works today and stays
  git-tracked archiving.

## Prerequisites

- cleanup removes merged worktrees and archives in-repo specs to completed/
- plan/intent write commit:false specs to the external home ~/.jarvis/specs/<proj>/
- the external-home path is derived from a project-safe id shared by intent/plan

## References

- Cleanup spec-archive path resolution: `v1/src/commands/cleanup.ts`.
- External-home resolution: `computeNoCommitSpecRoot` in `v1/src/modes/plan/spec-paths.ts`.
- Intake issue #566; sibling #529 (intent external-seeds-dir).
