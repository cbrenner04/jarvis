---
name: cleanup-routes-spec-to-correct-version-completed
---

# `jarvis cleanup` should archive a spec to the right `vN/spec/completed/` by what it changed

## Problem

`jarvis1 cleanup` archives every completed spec into `v2/spec/completed/` unconditionally. But most
specs the observer drives implement **v1** changes (code under `v1/`, `shared/`, or root config like
`biome.json`), not v2 planning work. So the operator must hand-move those specs from
`v2/spec/completed/` into `v1/spec/completed/` after every cleanup — a recurring manual step (now
documented in `v1/docs/operator-runbook.md` § End-of-session cleanup as the stopgap).

This is a north-star violation: a manual step that should be folded into an existing command.

## Direction

Make `cleanup` route an archived spec to `v1/spec/completed/` vs `v2/spec/completed/` based on what
the spec actually touched (the merged diff / files under its worktree), rather than always
`v2/spec/completed/`. A spec touching only `v2/` lands in `v2/spec/completed/`; one touching `v1/`,
`shared/`, or root lands in `v1/spec/completed/`. Reuse existing cleanup/archival logic; no new
command.

## Open questions (for plan to decide)

- Signal for the routing decision: the spec's own path prefix, the merged PR's changed files, or a
  declared marker in the spec? (Changed-files is most accurate but needs the merge diff at cleanup
  time.)
- Mixed specs (touch both `v1/` and `v2/`): which `completed/` wins? (Likely v1, since v1 is the
  shipping surface.)
- Should this also fix *where the spec is authored* (plan routing) so it's correct from the start,
  or only the archival destination?

## Out of scope

- Broader cleanup behavior (worktree removal, seed pruning) — unchanged.

## References

- `jarvis cleanup` implementation (worktree removal + `moved spec directory … -> v2/spec/completed/…`).
- `v1/docs/operator-runbook.md` § End-of-session cleanup — the manual stopgap this automates away.
