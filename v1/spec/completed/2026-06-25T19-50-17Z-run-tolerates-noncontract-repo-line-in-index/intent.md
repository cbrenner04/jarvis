---
name: run-tolerates-noncontract-repo-line-in-index
---

# `jarvis run` no longer aborts on a stray/relative `repo:` line in `index.md`

## Problem

`jarvis run`'s spec-repo parsing hard-aborts when an `index.md` carries a
`repo:` line it cannot resolve (observed: `repo: https://github.com/cbrenner04/jarvis`,
`repo: cbrenner04/jarvis`), failing with `spec repo must be an absolute path: …`.
A merged, otherwise-valid in-repo spec becomes un-runnable until the line is
hand-stripped.

## Behavior

When the spec resides inside a resolvable target (registered project or
ad-hoc git checkout), an unrecognized or relative `repo:` line in `index.md`
is ignored rather than fatal — run proceeds via the normal resolution order
instead of aborting. The hard error is reserved for cases where no other
resolution source succeeds. The legitimate `--repo` flag and the documented
URL/slug/registered-key `repo:` resolution are unchanged.

## Out of scope

- Plan-side prevention of the stray line (separate behavior).
- The legitimate `--repo` / project-resolution flow.

## References

- Spec-repo parsing: `resolveProjectFromSpec` in `v1/src/modes/shared-entry.ts`
  ("spec repo must be an absolute path" check); resolution order in
  `v1/docs/run-loop.md` and `v1/docs/spec-guidance.md`.
- Observed 2026-06-25 (auth-error + dep-adding index.md; PR #522 hand-fix).

## Prerequisites
