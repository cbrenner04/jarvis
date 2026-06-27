# `triage --merge` / `--mark-ready` handle marker-less worktrees

## Problem

`jarvis1 triage <worktree> --merge` (and `--mark-ready`) refuse with
`.active-spec-path marker not found (pre-marker worktree)` when the worktree lacks
the `.active-spec-path` marker. Observed 2026-06-27 finalizing an exit-6 run: the
operator could not dogfood the gated merge (the very tool that waits for CI-green
before merging) and fell back to hand `gh pr ready` + `gh pr merge --admin` —
which is how main got merged red.

The marker gap defeats the guardrail: the gated-merge path is unreachable on
exactly the worktrees that most need finalizing, so the unguarded manual path
gets used instead.

## Direction

Make the gated `triage --merge` / `--mark-ready` path work on a worktree that has
no `.active-spec-path` marker. Two angles to weigh in plan:

- **Backfill/derive the spec path** when the marker is absent (resolve from the
  worktree's branch ↔ spec mapping, the same way `run`/resolution finds it) instead
  of hard-refusing.
- **Always write the marker** at worktree creation so no run ever produces a
  marker-less worktree (closes it at the source).

Pick one (or both: write-going-forward + derive-for-legacy). The done-state: an
operator can always reach the green-gated merge for a completed run, so the
unguarded `gh pr merge --admin` path is never the only option.

## Documentation updates

- `v1/docs/operator-runbook.md` — once shipped, the Merging section presents
  `triage --merge` as the universal path (no marker caveat).
- `v2/docs/v1-behaviors.md` — record marker-less resolution / always-write-marker.
