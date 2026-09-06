---
name: cleanup-improvements
---

# Cleanup reports honestly and reclaims what terminal runs leave behind

## Problem

A 2026-08-28 `jarvis cleanup jarvis -y` sweep surfaced four defects that together turned a fully-quiescent repo (zero live runs, zero open PRs) into a 27-line skip list requiring a full manual teardown of 28 worktrees:

1. **Archive moves land uncommitted on the primary checkout.** Cleanup moved 7 spec dirs to `completed/` and exited, leaving the primary checkout dirty (`D` + `??` pairs on `main`). The operator has to notice, branch, commit, and PR the moves by hand.
2. **Terminal runs never release worktree claims.** Every "another materialized worktree owns this spec" skip pointed at a worktree whose run rows were all terminal (`completed`/`failed`/`killed`, not-live) and whose implementation PR had merged. Those claims are dead, but cleanup treats them as owners forever, so the owned specs are never archived and the worktrees are never torn down — 28 accumulated before manual git-level `worktree remove` + `prune` cleared them.
3. **Non-spec directories inspected as spec artifacts.** `v2/spec/.claude` (a coding-agent scratch dir) was reported as "no durable implementation branch" and `.jarvis-intent-stage` as "could not inspect spec completeness" — the latter for a directory that no longer existed on disk. Dot-dirs and staging dirs are not specs and deleted paths are not artifacts.
4. **The skip list prints duplicates.** Individual artifacts appeared up to three times in one run's output (e.g. the same stranded spec listed under both the stranded and non-stranded passes), roughly doubling the list the operator must triage.

5. **Merged-worktree retirement fails closed on a chained plan worktree its own implement dirtied (2026-09-06).** `git worktree remove` refuses a dirty tree, and a chained pipeline implement writes criteria ticks into the *plan* stage's worktree (`specReadRoot`), so the plan worktree is dirty by design once its implement runs. Cleanup reported `Failed to retire …/plan/write-sibling-step-id-matcher: Command failed: git worktree remove …` for two of three plan worktrees whose PRs (#3495, #3503) were merged; only a hand `git worktree remove --force` cleared them. The dirt is redundant — those ticks are already on `main` — but cleanup cannot tell, and the message names the git command rather than the dirty paths.

## Decisions

- A worktree whose spec has no live run (no run row in a non-terminal status claims it) is reclaimable: cleanup may tear it down and treat its spec as unowned, applying the normal completeness/archive rules. Rules out perpetual ownership by dead runs.
- Cleanup's own archive moves are committed and pushed on an operator branch with a PR (or, at minimum, cleanup states loudly that uncommitted moves remain and where). Rules out silently dirtying the primary checkout.
- Artifact inspection skips dot-directories and harness staging dirs (`.claude`, `.jarvis-intent-stage`, and kin) and drops entries whose path no longer exists at report time.
- Each skipped artifact is reported once per run, with one reason (or one merged reason line). Rules out the multi-pass duplicate listing.
- Decomposition into intents is left to the intent stage; these four defects need not land together.

## Acceptance criteria

- [ ] A worktree claimed only by terminal run rows is torn down by cleanup and its completed spec archived, pinned by a test that fails against the current owns-forever behavior.
- [ ] Cleanup leaves the primary checkout clean after archiving (moves committed/PR'd, or an explicit uncommitted-moves warning is emitted), pinned by a test.
- [ ] `v2/spec/.claude`-style dot-dirs, staging dirs, and since-deleted paths produce no skip lines, pinned by tests.
- [ ] One skip line per artifact per run, pinned by a test over a fixture that previously duplicated.
- [ ] A merged plan worktree dirtied only by its chained implement's criteria ticks is retired (the ticks being present on the merge base is the proof they are redundant), or the refusal names the dirty paths rather than the failed git command; pinned by a test that fails against the current `Command failed: git worktree remove` shape.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Folded slices (2026-09-05 compaction)

Absorbs the former `cleanup-reaps-aged-session-logs` and `cleanup-reaps-dead-daemon-log-and-pid-files` seeds, plus a fifth defect from the 2026-09-05 queue audit.

5. **Stranded-archival check is repo-wide, not spec-scoped.** One detached-HEAD worktree disabled archival for every spec in the project. Scope the check to the spec whose archival is being decided.
6. **Session-log retention (was its own seed, P2).** `~/.jarvis/sessions/` observed at 833,785 files / 6.2 GB (2026-08-31), never reaped; `run log` replays from the state store, not `sessions/`. Reap `.log` files for terminally-settled runs older than a config-tunable window (default 14 days), keyed on the owning run's terminal finish time — never a live/non-terminal run's log. `--dry-run` reports count + reclaimed bytes + oldest-kept date, not 830K filenames. **Never touch `telemetry.jsonl` or `state/v2.sqlite`** — both back `v2/docs/research/` reproduction scripts; pin the exclusion with a guard.
7. **Dead-daemon `.log`/`.pid` pairs (was its own seed, P3).** Socket reaping removes dead `.sock` files but leaves the paired `daemon-<digest>.log`/`.pid` accumulating one-per-digest since 2026-07-27. Reap them under the same liveness proof; optionally retain the most-recent-N dead logs for post-mortem; report in stdout and `--dry-run`.

Additional acceptance criteria carried from the folded seeds:

- [ ] Archival skip-scope: a detached-HEAD worktree on one spec does not block archival of unrelated completed specs, pinned by a test failing against the repo-wide check.
- [ ] Session logs for terminal runs older than the window are reaped, recent and live-run logs preserved, and a guard pins that the slice touches only `~/.jarvis/sessions/`; fails against the pre-fix no-reap.
- [ ] A dead digest's `.log`/`.pid` are removed with its dead `.sock`; a live daemon's triplet is preserved; fails against the socket-only reap.

## Documentation updates

- `v2/docs/operator-runbook.md` — Cleanup section: reclaim rule for terminal-run worktree claims; where archive commits land; session-log retention (window, terminal-run guard, the explicit telemetry/state-store research exclusion); dead-daemon file reaping; spec-scoped archival skips.
- `v2/docs/v1-behaviors.md` — record changed cleanup behavior.
