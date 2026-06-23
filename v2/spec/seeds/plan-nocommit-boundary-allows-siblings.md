---
name: plan-nocommit-boundary-allows-siblings
---

# `commit:false` plan boundary check rejects sibling `ready-intents/` and prior spec dirs

> Triaged from GitHub issue #416 (cbrenner04/jarvis).

## Problem

With `modes.plan.commit: false`, every `plan` run after the first blocks with a
`boundary violation detected before draft commit`, flagging `ready-intents/` and every
previously-generated spec dir under `~/.jarvis/specs/<project>/`. The draft spec tree is produced
correctly and is valid; only the post-draft boundary check fails — and it also appends a `## Blocker`
to the spec's `intent.md` and skips the review pass.

## Root cause

`assertNoCommitExternalSpecBoundary(externalSpecRoot, specDirBasename)`
(`v1/src/modes/plan/boundary.ts:164`) treats the **entire** external spec root
(`dirname(specDirPath)` = `~/.jarvis/specs/<projectId>/`) as the write boundary and flags **any**
top-level entry that isn't the active `<specDirBasename>` (loop at `boundary.ts:184-188`). But that
root legitimately contains:

- `ready-intents/` — written by `jarvis intent` (documented in intent-mode.md), and
- every previously-generated spec dir for that project (no-commit specs are explicitly not cleaned up).

So the check is mutually exclusive with the documented `intent → plan` no-commit pipeline and with
having more than one spec per project.

## Direction

The no-commit boundary check should verify the agent wrote only *within* the active spec dir during
this run (didn't escape into `src/`, etc.) — not that the active spec dir is the *sole* entry under
the shared project root. Options for plan to weigh:

- **Snapshot the root entry set before the draft**, only flag newly-created out-of-bounds entries.
- At minimum, **ignore `ready-intents/` and pre-existing sibling spec directories**.

## Repro

1. Per-project `plan.commit: false`.
2. `jarvis intent --repo <p> "<seed-a>"` → writes `ready-intents/a.md`.
3. `jarvis plan --repo <p> ~/.jarvis/specs/<p>/ready-intents/a.md` → blocks: `ready-intents` flagged.

## Out of scope

- The escape-detection intent itself (catching writes into `src/`) — keep that; only stop
  false-flagging legitimate siblings.

## References

- `v1/src/modes/plan/boundary.ts:164` — `assertNoCommitExternalSpecBoundary`.
- `v1/docs/intent-mode.md` — documents `ready-intents/` under the project spec root.
- GitHub issue #416.
