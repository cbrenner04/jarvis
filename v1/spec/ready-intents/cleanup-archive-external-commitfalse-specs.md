---
name: cleanup-archive-external-commitfalse-specs
---

# cleanup archives commit:false specs from the external home

## Problem

`jarvis1 cleanup` removes merged worktrees but, for a `commit:false` project,
never archives the completed spec. It resolves the spec under in-repo
`<repo>/spec/<name>`, prints `no spec directory moved ... missing
<repo>/spec/<name>`, and leaves the external spec dir behind. The operator then
manually `mv`s `~/.jarvis/specs/<proj>/<name>/` into the project's `completed/`
and deletes the consumed `ready-intents/<name>.md`.

## Direction

When the cleaned worktree's project has `plan.commit === false`, archive from the
external home instead of in-repo `spec/`: move
`~/.jarvis/specs/<proj>/<name>/` → `~/.jarvis/specs/<proj>/completed/<name>/`,
and prune the consumed `~/.jarvis/specs/<proj>/ready-intents/<name>.md` if
present. Resolve `<proj>` and the external home the same way `intent`/`plan` do
so the locations stay in lockstep. External moves are plain filesystem renames —
no `git add`/`commit`/`push` (the external home is not the target repo).
Existing in-repo `commit:true` archival (with its git commit/push) is unchanged.

## Verification

Verify against `groceries-client` (`plan.commit = false`): a merged spec's
external dir lands in `completed/` and its `ready-intents/<name>.md` is gone.

## Documentation updates

- `v1/docs/config.md` (or the cleanup reference) — note the external-home
  archival path and `ready-intents` prune under `commit:false`.
- Operator runbook end-of-session cleanup — drop the manual `mv`/prune note now
  that cleanup handles it.
- `v2/docs/v1-behaviors.md` — record the commit:false external archival
  behavior (cleanup behavior change to existing functionality).

## Prerequisites

- jarvis1 cleanup removes merged worktrees and archives in-repo commit:true specs
- intent/plan author commit:false specs into the external home ~/.jarvis/specs/<proj>/<name>/ and consume ready-intents/<name>.md
