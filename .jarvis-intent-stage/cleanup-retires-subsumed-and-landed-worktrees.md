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

- `plan/<name>` worktrees gain a second retirement authority when no OPEN PR exists and any PR is CLOSED or absent, every `base..head` path lies under the lane spec dir, consumed ready-intent, or harness staging (`unlandedNonStagingPaths`), and that spec dir exists on the default branch open or under `completed/` (`git ls-tree`, same posture as hand-landed archival). Any failed component stays ineligible.
- Existing guards stay unconditional for both authorities: non-terminal durable run, daemon-live run, fail-closed `gh`/daemon, apply-time recheck, dirty-worktree refusal, local-only ref scope unchanged.
- Non-`plan/*` worktrees are never auto-retired. With no OPEN PR and the resolved spec under `completed/` on the default branch, cleanup prints `Landed elsewhere: <path> — <reason>; run jarvis cleanup --abandon <branch> --discard-unlanded after verifying` and does not remove the worktree. `--abandon` unlanded-commit guards unchanged.
- The merged-worktree dirty refusal line appends the same suggested `--abandon` command; removal behavior unchanged.
- Complements closed-PR supersede hygiene; either authority suffices for subsumed plan lanes.

## Acceptance criteria

- [ ] `cleanup.test.ts`: a `plan/*` worktree with a CLOSED PR, spec-only commits, and its spec dir on the default branch (open, and separately under `completed/`) is retired; same with no PR; fails against the baseline.
- [ ] `cleanup.test.ts`: each broken component stays ineligible — OPEN PR, a commit touching a path outside the spec dir/ready-intent/staging, spec dir absent from the default branch, non-terminal run, live daemon run.
- [ ] `cleanup.test.ts`: an implement worktree with a CLOSED PR and its spec under `completed/` on the default branch prints the `Landed elsewhere` line with the `--abandon` command and is not removed in dry-run or apply; one with an OPEN PR prints nothing.
- [ ] `cleanup.test.ts`: the dirty merged-worktree refusal line names the suggested `--abandon` command.
- [ ] Existing merged-PR retirement tests stay green; `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — plan-lane authority, `Landed elsewhere` report, refusal suggestion; § Pipeline approve and reject "Landing pipeline stage PRs" — closed plan PRs retire on cleanup.
- `v2/docs/v1-behaviors.md` — record the eligibility change.

## Prerequisites

- Bulk cleanup retires merged-PR worktrees when durable-run and daemon-live guards pass.
- `unlandedNonStagingPaths` compares `base..head` and treats spec-dir, ready-intent, and harness staging paths as in-scope for abandon guards.
