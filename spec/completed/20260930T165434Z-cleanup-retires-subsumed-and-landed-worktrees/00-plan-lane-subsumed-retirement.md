# 00 — Plan-lane subsumed retirement

## Problem

Bulk cleanup retires a worktree only when its branch PR merged. Closed or never-opened `plan/*` lanes with spec-only work and the spec already on the default branch stay on disk until manual `--abandon`.

## Decision ledger

- Second retirement authority applies only to branches matching `plan/*` with an in-repo spec home; rules out external `plan.commit: false` lanes under `~/.jarvis/specs/.../plans/` (operator keeps `--abandon` or merged-PR retirement).
- Plan-lane spec directory identity drives path-scope checks and default-branch `git ls-tree` targets: resolve from durable runs on `(project, branch)` via the same `sourceForRun` walk as `resolveMergedWorktreeSpecIndexPath`, take the spec-tree directory (parent of `index.md`), with `artifactForRetiredWorktree` precedence when multiple rows qualify; if no row qualifies, infer the shallowest repo-relative path under the registered project's in-repo `plan.targetDir` that contains an `index.md` touched in `base..head`; unresolved identity → ineligible (rules out guessing from unrelated spec trees).
- Subsumed eligibility requires no OPEN PR, PR state CLOSED or absent (not MERGED), every `base..head` path under the resolved spec directory, the lane's consumed ready-intent, or harness workflow staging, and the resolved spec directory present on the repository default branch at `HEAD` or under `<targetDir>/completed/` (read-only `git ls-tree` posture matching hand-landed archival); any failed component → ineligible (rules out treating `gh`/PR-probe failure as “no open PR”).
- PR gate probe is `gh pr list --head <branch> --state all --json state` (reuse the `mergedPrHeadAuthorityMatches` shape): empty array = absent; any OPEN → ineligible; non-zero exit or non-array/unparseable JSON → ineligible — rules out `gh pr view` failure as the absent signal.
- Merged-PR authority stays first for `plan/*` when `isMerged` succeeds; subsumed authority is evaluated only when merged authority fails (rules out skipping merged hygiene when the lane PR actually merged).
- Existing guards apply unchanged to subsumed candidates: non-terminal durable run, daemon-live run, daemon-unreachable fail-closed, apply-time eligibility recheck, `planMergedWorktreeRemoval` dirty refusal.
- Subsumed apply uses the same dry-run candidate listing and retirement sequence as merged worktrees; post-removal artifact hygiene matches merged retirement when a provable artifact exists, but skip spec-tree archival when that tree already exists on the default branch open or under `completed/` (rules out duplicate archive commits for hand-landed plan specs).
- Lane path scope reuses the `base..head` name list from `unlandedNonStagingPaths` and extends allowance beyond harness staging to the resolved spec directory and consumed ready-intent; rules out reimplementing a separate diff driver.

## Work

- Add plan-lane spec directory resolution (durable-run walk + shallowest `index.md` under `plan.targetDir` fallback).
- Add subsumed plan-lane eligibility (PR gate, path scope, default-branch spec presence) and wire it into worktree discovery so eligible lanes appear in dry-run preview and apply retirement alongside merged lanes.
- Skip in-repo spec archival on subsumed retirement when the spec tree is already on the default branch open or under `completed/`.
- Extend or wrap `unlandedNonStagingPaths` so plan-lane scope treats spec-dir and consumed ready-intent paths as allowed alongside harness staging.

## Acceptance criteria

- [x] `cleanup.test.ts`: a `plan/*` worktree with a CLOSED PR, commits only under the resolved spec dir / consumed ready-intent / harness staging, and its spec dir on the default branch (open, and separately under `completed/`) is listed in dry-run preview and removed on apply; the same with no PR; fails against the pre-fix baseline.
- [x] `cleanup.test.ts`: each broken component leaves the worktree ineligible — OPEN PR, PR-probe failure on the plan path (not treated as closed/absent), a commit touching a path outside the spec dir / ready-intent / staging, spec dir absent from the default branch, non-terminal durable run, daemon-live run.
- [x] `cleanup.test.ts` merged-PR retirement cases (for example `plan/archive-me` and related archive preview tests) stay green.

## Documentation updates

- Deferred to [03-documentation.md](./03-documentation.md).
