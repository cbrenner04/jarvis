---
name: triage-finalize-without-active-spec-path-marker
---

# `triage --merge` / `--mark-ready` work without `.active-spec-path`

## Problem

`jarvis1 triage <worktree> --merge` and `--mark-ready` refuse with
`.active-spec-path marker not found (pre-marker worktree)` when the worktree lacks
the marker. That blocks the gated merge path on completed runs — the worktrees that
most need finalizing — and pushes operators to unguarded `gh pr merge --admin`.

## Direction

When the marker is absent, derive the active spec path from the worktree branch
↔ spec mapping (same resolution cleanup/archive uses: patch branch basename,
`plan/` prefix with timestamped directory match, configured `plan.targetDir` plus
`v1/spec` / `v2/spec` fallbacks) instead of hard-refusing.

- Apply in the shared named-worktree resolution used by `--mark-ready` and `--merge`.
- Prefer an existing marker when present; derivation is fallback only.
- Resolve to an on-disk spec file (`index.md` when the directory has one; else the
  single spec file) before completeness / gate / merge pre-checks run.
- Unresolvable branch (no matching spec directory) still refuses with a clear error
  before side effects.

Docs: `v2/docs/v1-behaviors.md` records marker-less derivation semantics;
`v1/docs/operator-runbook.md` Merging section drops any marker caveat — present
`triage --merge` as the universal gated path.

## Out of scope

- Writing `.active-spec-path` at worktree creation (separate intent).
- Read-only `triage` drill-down marker-less display (may align opportunistically).

## Prerequisites

- Gated `triage --merge` polls CI to green then admin-squash-merges.
- `triage --mark-ready` finalizes a complete worktree (commit-if-dirty, ensure draft PR, gate once, mark ready).
