# triage --merge can't resolve a plan PR's spec before it's merged

`jarvis1 triage <spec-path|pr-ref|worktree-name> --merge` on a fresh plan
worktree (no `.active-spec-path` marker) refuses with
`no spec found for branch plan/<name>` even when the branch and its spec
directory both exist and CI is green.

Root cause (`v1/src/commands/triage.ts`, `deriveSpecPathFromBranch` /
`resolveSpecFromWorktreeOrBranch`): when the marker is absent it scans
`opts.projectRoot`'s `<targetDir>` (the primary checkout, on `main`) for a
directory whose timestamp-stripped name matches the branch suffix. A plan
PR's spec directory is committed only on the `plan/<name>` branch — it
doesn't exist in the primary checkout's working tree until the PR merges —
so the scan always misses pre-merge, regardless of spec path, PR number, or
worktree name passed in.

Fix: for `plan/*` branches, also (or instead) scan the **worktree's own**
`<targetDir>` — `worktreePath` is already available at the call site — since
the spec directory is present there via the checked-out branch. Add a
regression test: a plan worktree with a timestamped spec dir committed only
on its own branch (not in the primary checkout) should resolve via
`triage --merge`.

Once fixed, remove the "Known gap" paragraph under Merging → Gated merge
path in `v1/docs/operator-runbook.md` (the hand-merge workaround it
documents becomes unnecessary).
