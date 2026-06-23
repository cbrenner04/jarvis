---
name: commit-false-rerun-worktree-reuse
---

# Reuse or clean the prior worktree on `commit:false` re-run

## Problem

Under `commit:false`, a friction-blocked attempt leaves its worktree behind. Re-running
the same spec then requires the operator to hand-clean the orphaned worktree before each
retry, instead of the re-run being a single jarvis command.

## Direction

On re-run of an incomplete `commit:false` spec, automatically reuse or clean the prior
attempt's worktree instead of orphaning it. Plan to weigh: reuse the existing worktree in
place vs. tear it down and create fresh; whether this is the default re-run path or gated
behind an explicit `--retry`/`--fresh` affordance.

## Out of scope

- Source-spec AC/blocker reset (separate behavior).
- Changing the `commit:false` model itself (operator-merges-only, one-PR-per-item stays).

## References

- `v1/docs/worktrees-and-commits.md` — worktree lifecycle.

## Prerequisites

- A `commit:false` patch run leaves its worktree behind after a friction-blocked attempt.

## Blocker

The declared prerequisite — "a `commit:false` patch run leaves its worktree behind after a friction-blocked attempt" — is not observable in committed code. Two facts contradict it:

- `commit` is a **plan-mode-only** config key. Patch mode (`jarvis run`) has no `commit` setting; `modes.patch` accepts no `commit`. See `v1/src/config.ts:87` (`commit?: boolean; // plan mode only`) and the validated plan-key set `{specTimestamp, commit, targetDir}` (`config.ts:452`). So "a `commit:false` patch run" does not exist.
- Plan-mode `commit:false` creates **no worktree at all** — it runs against `project.root` directly (`v1/src/modes/plan/run.ts:834`, "For commit: false, use project root directly"). On a friction-blocked attempt the external spec dir under `~/.jarvis/specs/...` is preserved (no `.worktree/` is created), so there is no orphaned worktree to reuse or clean.

There is no `commit:false` path — patch or plan — that orphans a worktree. The "operator-merges-only, one-PR-per-item" model named in *Out of scope* also does not correspond to any current `commit:false` behavior.

Closest real behaviors, in case the intent is mis-describing one of them — pick one and revise the intent:

1. **Plan `commit:true` (default) re-run.** `createManagedWorktree` (`v1/src/worktree.ts:84`) **throws** `"plan worktree already exists at <path>; resolve with jarvis1 cleanup or remove manually"` when `.worktree/plan-<name>/` survives a friction-blocked plan attempt. This matches "requires the operator to hand-clean before each retry" — but it is plan mode, `commit:true`, and a `plan-` worktree, not `commit:false`.
2. **Patch re-run.** `ensureWorktree` (`v1/src/worktree.ts:33`) **already silently reuses** a pre-existing `.worktree/<spec>/`. If the goal is patch-mode reuse, it already exists; clarify what additional behavior (e.g. clean-vs-reuse choice, `--fresh`) is wanted.

Please revise `intent.md` to name the real mode + commit setting + worktree path you mean, then re-run plan.
