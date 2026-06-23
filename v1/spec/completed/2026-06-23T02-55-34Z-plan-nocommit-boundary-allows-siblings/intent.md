---
name: plan-nocommit-boundary-allows-siblings
---

# `commit:false` plan boundary check allows sibling `ready-intents/` and prior spec dirs

> Triaged from GitHub issue #416 (cbrenner04/jarvis).

## Problem

With `modes.plan.commit: false`, every `plan` run after the first blocks with
`boundary violation detected before draft commit`, flagging `ready-intents/` and every
previously-generated spec dir under the shared project spec root
(`~/.jarvis/specs/<projectId>/`). The draft tree is valid; only the post-draft boundary check fails —
it also appends a `## Blocker` to `intent.md` and skips the review pass.

Root cause: `assertNoCommitExternalSpecBoundary` (`v1/src/modes/plan/boundary.ts:164`) treats the
entire project spec root as the write boundary and flags any top-level entry that isn't the active
`<specDirBasename>`. That root legitimately holds `ready-intents/` (written by `jarvis intent`,
documented in intent-mode.md) and prior no-commit spec dirs (explicitly not cleaned up), so the check
is mutually exclusive with the documented `intent → plan` pipeline and with multiple specs per project.

## Behavior

The no-commit boundary check verifies the agent wrote only *within* the active spec dir during this
run — not that the active spec dir is the sole entry under the shared project root. A `commit:false`
plan run over a project root containing `ready-intents/` and pre-existing sibling spec dirs completes
without a false boundary violation, no `## Blocker` appended, review pass runs. A genuine escape (a
write outside the active spec dir, e.g. into `src/`) is still flagged and reverted as before.

## Out of scope

- The escape-detection behavior itself — keep it; only stop false-flagging legitimate siblings.

## References

- `v1/src/modes/plan/boundary.ts:164` — `assertNoCommitExternalSpecBoundary`.
- `v1/docs/intent-mode.md` — documents `ready-intents/` under the project spec root.
- GitHub issue #416.

## Prerequisites
