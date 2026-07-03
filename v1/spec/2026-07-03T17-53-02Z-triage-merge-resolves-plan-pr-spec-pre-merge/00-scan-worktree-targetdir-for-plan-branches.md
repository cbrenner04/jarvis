# Scan the worktree's own targetDir for plan branches

## Problem

`jarvis1 triage <spec-path|pr-ref|worktree-name> --merge` on a fresh plan
worktree (no `.active-spec-path` marker) refuses with
`no spec found for branch plan/<name>` even when the branch and its spec
directory both exist and CI is green.

`deriveSpecPathFromBranch` (`v1/src/commands/triage.ts`) only scans
`opts.projectRoot`'s target dirs (the primary checkout, on `main`). A plan
PR's spec directory is committed only on `plan/<name>` — absent from the
primary checkout pre-merge — so the scan always misses, even though
`resolveTriageNamedWorktree` already has `worktreePath` in scope and the
branch is checked out there.

## Decisions

- `deriveSpecPathFromBranch` takes an additional `worktreePath` parameter.
- Plan-branch predicate: `branch.startsWith("plan/")` (existing `isPlan` local)
  gates the worktree fallback — only `plan/*` branches ever scan
  `worktreePath`; all other branches are unaffected.
- Match priority: `projectRoot` is scanned first; `worktreePath` is only
  consulted when that scan misses. A `projectRoot` match wins even if
  `worktreePath` would also match.
- For `plan/*` branches only, on a `projectRoot` miss, scan `worktreePath`'s
  target dirs (same `configuredTargetDir`/`v1/spec`/`v2/spec` set, same
  candidate/timestamp logic, no new matching algorithm).
- Verified via grep: `deriveSpecPathFromBranch` has exactly one call site,
  in `resolveTriageNamedWorktree` (`v1/src/commands/triage.ts`), which
  already has `worktreePath` in scope — no other caller needs updating.

## Task Checklist

- [ ] Add `worktreePath` param to `deriveSpecPathFromBranch`; for `plan/*`
      branches, fall back to scanning it when `projectRoot` yields no match.
- [ ] Update the call site to pass `worktreePath`.
- [ ] Add a test: fresh plan worktree, no `.active-spec-path` marker, spec
      directory committed only in the worktree's `v1/spec` (not in
      `projectRoot`'s), `triage --merge` resolves the spec and merges.
- [ ] Add a test: fresh plan worktree, no matching spec in either
      `projectRoot` or `worktreePath` — `triage --merge` still surfaces the
      original `no spec found for branch` error (no throw, no silent match).

## Acceptance criteria

- [ ] `triage --merge` on a markerless `plan/<name>` worktree whose spec
      directory exists only on the checked-out branch (not in the primary
      checkout) resolves the spec and proceeds to merge instead of refusing
      with `no spec found for branch`.
- [ ] `triage --merge` on a markerless `plan/<name>` worktree with no
      matching spec in either the primary checkout or the worktree still
      returns the `no spec found for branch` error.
- [ ] Existing markerless-derive tests in `v1/test/triage-command.test.ts`
      (e.g. "--merge markerless resolved worktree derives spec from branch
      and merges", "--merge with missing .active-spec-path and no matching
      spec returns error") stay green (behavior unchanged for non-plan
      branches and for plan branches whose spec is already merged to main).
- [ ] The "Known gap" paragraph under Merging → Gated merge path is removed
      from `v1/docs/operator-runbook.md`.
- [ ] `v2/docs/v1-behaviors.md` records that `triage --merge` resolves a
      markerless plan-branch spec from the worktree's own target dir when
      the primary checkout doesn't yet have it.

## Documentation updates

- Remove the "Known gap" paragraph under Merging → Gated merge path in
  `v1/docs/operator-runbook.md` (the hand-merge workaround it documents
  becomes unnecessary).
- Update `v2/docs/v1-behaviors.md` to record that `triage --merge` resolves
  a markerless plan-branch spec from the worktree's own target dir when the
  primary checkout doesn't yet have it.
