---
name: cleanup-archive-already-merged-specs
---

# `jarvis1 cleanup` should archive already-merged specs whose worktree is already gone

`jarvis1 cleanup` only archives a spec into `completed/` when it removes that spec's
worktree in the same run. A spec merged in a prior session — or merged via
`jarvis1 triage --merge` without a following `cleanup` — has no surviving worktree, so
cleanup never archives it. These shipped spec dirs accumulate at `<targetDir>` root
(observed: 20 seed-01–07 dirs stranded at `v2/spec/` root after the shrink session), and
the operator archives them by hand.

## Decisions

- On every `jarvis1 cleanup` run, after the worktree-removal pass, **also scan `<targetDir>`
  root for spec dirs that are archivable independent of a just-removed worktree**: the spec
  is complete (finalize completeness — every non-human-only AC across linked subspecs
  checked, or the sole file), has **no open PR** on its name, and has **no live
  `.worktree/<spec-name>/`**. Archive each into `<targetDir>/completed/`.
- Reuse the existing archival completeness + guard logic (shared with `triage --mark-ready`);
  this only drops the "must have removed the worktree this run" precondition.
- Plan-only dirs whose implementation shipped under a different worktree still count as
  complete when their AC are checked; a plan dir with unchecked AC stays put (same rule as today).
- Dry-run (`--dry-run`) must list these root-archival moves too.

## Out of scope

- `commit:false` external-home archival changes beyond the existing behavior.
- Auto-ticking AC — archival still requires AC already satisfied.

## Documentation updates

- `v1/docs/operator-runbook.md` (§ End-of-session cleanup): note cleanup now archives
  already-merged specs at `<targetDir>` root, so the operator no longer hand-moves stranded
  shipped spec dirs.
