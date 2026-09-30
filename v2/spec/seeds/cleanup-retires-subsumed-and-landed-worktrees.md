---
name: cleanup-retires-subsumed-and-landed-worktrees
---

# Cleanup retires subsumed plan lanes and names landed-elsewhere worktrees

## Problem

`checkEligibility` (`v2/src/commands/cleanup.ts:273`) retires a worktree only when its own branch's PR is merged (`isMerged`, `cleanup.ts:283`/`:322`, `gh pr view <branch> --json state,mergedAt`). Pipeline plan-stage PRs are closed as subsumed by the implement PR (runbook § Pipeline approve and reject, "Landing pipeline stage PRs": merge the terminal implement PR, close earlier stage PRs), and some plan lanes never open a PR, so `plan/*` worktrees are never retired. Implement worktrees whose work landed through a salvage PR are likewise stuck. `findEligibleWorktreeCandidates` (`cleanup.ts:1452`) drops every non-merged ineligible worktree silently (only daemon-unreachable is surfaced), so the operator gets no pointer to them.

## Evidence

- 2026-09-30 session 1: 22 landed worktrees left for manual `jarvis cleanup --abandon`.
- 2026-09-30 session 2: 7 manual `--abandon --discard-unlanded` calls: `plan/capture-pr-review-input` (#4207 closed), `plan/non-pipeline-preset` (#4205 closed), `plan/stale-reset-compares-specs-at-read-root` (#4169 closed), `plan/roll-and-retain-monthly-telemetry` (no PR); implement `20260929T220626Z-repair-exhausted-error-names-site-and-killing-set` (#4175 closed; landed via #4180), `20260929T220626Z-pipeline-resume-resumes-resumable-implement-row` (no PR, dirty; landed via #4186), `20260930T051311Z-review-feedback-lane-admission` (#4234 merged, refused by `planMergedWorktreeRemoval` `cleanup.ts:2284` for uncommitted tracked source edits).

## Decisions

- New retirement authority for `plan/<name>` worktrees only: no OPEN PR on the branch, and its PR is CLOSED or absent; every `base..head` changed path lies under the lane's produced spec dir (`<targetDir>/<UTC>-<name>/`), its consumed ready-intent, or harness staging (reuse `unlandedNonStagingPaths`, `cleanup.ts:2971`); and that spec dir exists on the default branch, open or under `completed/` (read via `git ls-tree`, as hand-landed archival does). Any broken component → ineligible, as today.
- Existing guards stay unconditional for the new authority: non-terminal durable run, daemon-live run, fail-closed `gh`/daemon, apply-time recheck, dirty-worktree refusal. Local-only ref scope unchanged.
- Implement (non-`plan/*`) worktrees gain no automatic retirement. When the branch has no OPEN PR and its resolved spec is under `completed/` on the default branch, cleanup reports it as `Landed elsewhere: <path> — <reason>; run jarvis cleanup --abandon <branch> --discard-unlanded after verifying` and never touches it. The unlanded-commits guard in `--abandon` stays.
- The merged-worktree dirty refusal line (`cleanup.ts:2259`) appends the same suggested `--abandon` command; behavior unchanged.
- Complements `superseded-pipeline-pr-hygiene` Slice 3 (closed PR + harness supersede comment); either authority suffices.

## Acceptance criteria

- [ ] `cleanup.test.ts`: a `plan/*` worktree with a CLOSED PR, spec-only commits, and its spec dir on the default branch (open, and separately under `completed/`) is retired; same with no PR. Fails against the baseline.
- [ ] `cleanup.test.ts`: each broken component stays ineligible — OPEN PR, a commit touching a path outside the spec dir/ready-intent/staging, spec dir absent from the default branch, non-terminal run, live daemon run.
- [ ] `cleanup.test.ts`: an implement worktree with a CLOSED PR and its spec under `completed/` on the default branch prints the `Landed elsewhere` line with the `--abandon` command and is not removed in dry-run or apply; one with an OPEN PR prints nothing.
- [ ] `cleanup.test.ts`: the dirty merged-worktree refusal line names the suggested `--abandon` command.
- [ ] Existing merged-PR retirement tests stay green; `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — the plan-lane authority, the `Landed elsewhere` report, the refusal suggestion; § Pipeline approve and reject "Landing pipeline stage PRs" — closed plan PRs now retire on cleanup.
- `v2/docs/v1-behaviors.md` — record the eligibility change.
