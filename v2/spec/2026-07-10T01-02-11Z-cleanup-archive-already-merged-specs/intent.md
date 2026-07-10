---
name: cleanup-archive-already-merged-specs
---

# `jarvis1 cleanup` archives already-merged specs with no live worktree

`jarvis1 cleanup` only archives a spec when it removes that spec's worktree in
the same run. Specs merged in a prior session, or via `triage --merge` without
a following `cleanup`, never get archived — they accumulate at `<targetDir>`
root and the operator moves them by hand.

## Decisions

- After the worktree-removal pass, scan `<targetDir>` root for spec dirs that
  are archivable independent of a just-removed worktree: complete (finalize
  completeness — all non-human-only AC checked across linked subspecs, or the
  sole file), no open PR on its name, no live `.worktree/<spec-name>/`.
- Archive each into `<targetDir>/completed/`.
- Reuse the existing archival completeness + guard logic shared with
  `triage --mark-ready`; only the "removed a worktree this run" precondition drops.
- Plan-only dirs implemented under a different worktree count as complete once
  their AC are checked; a dir with unchecked AC stays put (same as today).
- `--dry-run` lists these root-archival moves too.

## Out of scope

- `commit:false` external-home archival changes beyond existing behavior.
- Auto-ticking AC — archival still requires AC already satisfied.

## Documentation updates

- `v1/docs/operator-runbook.md` (§ End-of-session cleanup): note cleanup now
  archives already-merged specs at `<targetDir>` root; operator no longer
  hand-moves stranded shipped spec dirs.

## Prerequisites
