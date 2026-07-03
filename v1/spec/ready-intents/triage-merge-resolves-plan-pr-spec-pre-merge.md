---
name: triage-merge-resolves-plan-pr-spec-pre-merge
---

# triage --merge resolves a plan PR's spec before it merges

## Problem

`jarvis1 triage <spec-path|pr-ref|worktree-name> --merge` on a fresh plan
worktree (no `.active-spec-path` marker) refuses with
`no spec found for branch plan/<name>` even when the branch and its spec
directory both exist and CI is green.

`deriveSpecPathFromBranch` / `resolveSpecFromWorktreeOrBranch` in
`v1/src/commands/triage.ts` scan `opts.projectRoot`'s `<targetDir>` (the
primary checkout, on `main`) for a directory matching the branch suffix. A
plan PR's spec directory is committed only on `plan/<name>` — absent from
the primary checkout pre-merge — so the scan always misses.

## Decisions

- For `plan/*` branches, also scan the worktree's own `<targetDir>` (`worktreePath` is already available at the call site) — the spec directory is present there via the checked-out branch.

## Documentation updates

- Remove the "Known gap" paragraph under Merging → Gated merge path in `v1/docs/operator-runbook.md` (the hand-merge workaround it documents becomes unnecessary).

## Prerequisites
