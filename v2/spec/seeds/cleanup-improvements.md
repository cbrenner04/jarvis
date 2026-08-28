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
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Cleanup section: reclaim rule for terminal-run worktree claims; where archive commits land.
- `v2/docs/v1-behaviors.md` — record changed cleanup behavior.
