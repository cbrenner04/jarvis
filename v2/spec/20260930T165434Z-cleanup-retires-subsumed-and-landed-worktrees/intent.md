---
name: cleanup-retires-subsumed-and-landed-worktrees
---

# Cleanup retires subsumed plan lanes and names landed-elsewhere worktrees

Unsplit rationale: plan-lane subsumed retirement, implement `Landed elsewhere` reporting, and the dirty merged-worktree refusal hint all live in `v2/src/commands/cleanup.ts` worktree eligibility and discovery; one CLI command surface.

## Primary implementation surface

- `v2/src/commands/cleanup.ts` — `checkEligibility`, worktree candidate discovery/reporting, merged-worktree removal refusal lines

## Problem

Bulk cleanup retires a worktree only when its branch PR merged. Subsumed pipeline plan PRs stay closed without merge, some plan lanes never open a PR, and implement work that landed via a salvage PR leaves stale worktrees. Ineligible non-merged worktrees are dropped silently except daemon-unreachable.

## Decisions

- Plan-lane spec dir identity (drives `unlandedNonStagingPaths` scope and the default-branch `git ls-tree` target): for `plan/*` only, resolve from durable runs on the worktree branch — same project+branch rows as `resolveMergedWorktreeSpecIndexPath` / `sourceForRun`, spec-tree directory (parent of `index.md`) with `artifactForRetiredWorktree` precedence when multiple rows exist; if no qualifying run row, infer the shallowest repo path under the registered project's in-repo `plan.targetDir` that contains an `index.md` touched in `base..head`; failure to resolve → ineligible. External plan homes (`plan.commit: false` under `~/.jarvis/specs/.../plans/`) are out of scope for this authority — no default-branch ls-tree there; operator uses `--abandon` or waits for merged-PR retirement.
- `plan/<name>` worktrees gain a second retirement authority when no OPEN PR exists and any PR is CLOSED or absent, every `base..head` path lies under that resolved lane spec dir, consumed ready-intent, or harness staging (`unlandedNonStagingPaths`), and that spec dir exists on the default branch open or under `completed/` (`git ls-tree`, same posture as hand-landed archival). Any failed component stays ineligible.
- Existing guards stay unconditional for both authorities: non-terminal durable run, daemon-live run, fail-closed `gh`/daemon (plan authority: OPEN/CLOSED/absent PR probe failure → ineligible, never “no open PR”), apply-time recheck, dirty-worktree refusal, local-only ref scope unchanged.
- Non-`plan/*` worktrees are never auto-retired. With no OPEN PR and the resolved spec under `completed/` on the default branch, cleanup prints `Landed elsewhere: <path> — <reason>; run jarvis cleanup --abandon <branch> --discard-unlanded after verifying` and does not remove the worktree. Resolved spec for implement lanes is the repo-relative spec index path from the same durable-run walk as merged dirty retirement (`resolveMergedWorktreeSpecIndexPath` / `sourceForRun` → stale-reset spec tree); `--abandon` unlanded-commit guards unchanged.
- Subsumed plan-lane apply uses the same dry-run candidate listing as merged retirement (preview lines, no removal). Post-removal hygiene matches merged-PR retirement when a provable artifact exists (ready-intent byte-proof prune, etc.), but skip spec-tree archival when that tree already exists on the default branch open or under `completed/`.
- The merged-worktree dirty refusal line appends the same suggested `--abandon` command; removal behavior unchanged.
- Complements closed-PR supersede hygiene; either authority suffices for subsumed plan lanes.

## Acceptance criteria

- [ ] `cleanup.test.ts`: a `plan/*` worktree with a CLOSED PR, spec-only commits, and its spec dir on the default branch (open, and separately under `completed/`) is retired on apply and listed in dry-run preview; same with no PR; fails against the baseline.
- [ ] `cleanup.test.ts`: each broken component stays ineligible — OPEN PR, `gh`/PR-probe failure on the plan path (not treated as closed/absent), a commit touching a path outside the spec dir/ready-intent/staging, spec dir absent from the default branch, non-terminal run, live daemon run.
- [ ] `cleanup.test.ts`: an implement worktree with a CLOSED PR and its spec under `completed/` on the default branch prints the `Landed elsewhere` line with the `--abandon` command and is not removed in dry-run or apply; one with an OPEN PR prints nothing.
- [ ] `cleanup.test.ts`: the dirty merged-worktree refusal line names the suggested `--abandon` command.
- [ ] Existing merged-PR retirement tests stay green; `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — plan-lane authority (in-repo only), spec-dir resolution, `Landed elsewhere` report, refusal suggestion, dry-run preview; § Pipeline approve and reject "Landing pipeline stage PRs" — closed in-repo plan PRs retire on cleanup; external plan lanes excluded from subsumed authority.
- `v2/docs/v1-behaviors.md` — record the eligibility change.

## Prerequisites

- Bulk cleanup retires merged-PR worktrees when durable-run and daemon-live guards pass.
- `unlandedNonStagingPaths` compares `base..head` and exempts harness staging paths only; this spec extends allowance to the lane spec dir and consumed ready-intent.
