---
name: spare-green-unticked-iteration
---
# Don't hard-stop a green iteration that edited files but ticked nothing

**Scope.** The patch implementation-path stop at `iteration.ts` ~`:855-867` that returns exit `6` when an iteration edits files, ticks no new acceptance criterion, and leaves a dirty worktree. Give a bounded chance to tick before stopping. Additive; does not touch the true no-progress stop (exit `4`, no edits) or the fix-up/blocker paths.

## Problem

When an agent completes a subspec's work in one iteration but ends its turn before ticking the acceptance-criteria boxes, the harness sees "edited files, no new AC checked, worktree dirty" and immediately returns exit `6` (`iteration.ts` ~`:855-867`, message "edited files but checked no new acceptance criteria … the worktree is not clean"). The work is done and green; the only thing missing is the ticks. The operator must re-run jarvis purely so the agent ticks — roughly doubling the agent cost of every spec whose work lands in a single iteration.

Deadlock variant: if the agent ticked the boxes *in the subspec file* but the harness stopped before committing them, a re-run sees the ACs already ticked (uncommitted), detects "no new AC checked" again, and stops again — the ticks can never commit without manual intervention.

## Evidence (this session)

Every multi-subspec spec hit this on its first run: `idle-output-watchdog-2`, `shared-spec-blocker-parsing`, `plan-draft-structural-validation` (which deadlocked on ticked-but-uncommitted ACs), and `shared-invocation-executor`/`split-god-modules` per subspec — each needed a re-run (or manual finalize) only to land the ticks on already-green work.

## Desired behavior

An iteration that edits files but ticks no new AC, on an otherwise-green tree, gets a bounded number of additional iterations to tick the satisfied criteria before the harness stops — instead of stopping on the first occurrence. A genuinely stuck agent (no ticks after the bound, or no edits at all) still stops as today. Acceptance criteria already ticked in the subspec file but not yet committed are treated as progress (committed and counted), so a re-run can never deadlock on its own uncommitted ticks.

## Decisions

- On the first "edited-files, no-new-AC, dirty-worktree" outcome, loop back for a bounded retry (small N, e.g. 2) so the agent can tick, rather than returning exit `6` immediately. After the bound with still no new tick, return exit `6` as today. Rules out an unbounded retry that lets a non-ticking agent spin.
- Uncommitted ticks present in the subspec at the start of an iteration count as progress: commit them and re-evaluate completion before deciding "no new AC checked". Rules out the re-run deadlock where already-ticked-but-uncommitted ACs read as no-progress.
- The retry does not auto-tick on the agent's behalf — the agent still owns ticks (consistent with the existing harness-cannot-judge-criteria rule); the harness only declines to give up after one turn. Rules out harness auto-ticking acceptance criteria.
- The true no-progress stop (exit `4`, no edits and no ticks) and the fix-up/blocker exit paths are unchanged. Rules out widening this into the genuinely-stuck or blocker cases.

## Acceptance signals

- An iteration that edits files and ticks no new AC on a clean-after-commit/green tree is followed by a bounded retry that lets a ticking agent complete in the same run (no operator re-run), proven with a fake agent that ticks on its second turn (test).
- A subspec whose ACs are ticked in the file but uncommitted, re-entered, commits those ticks and proceeds rather than re-detecting no-progress (test).
- An agent that never ticks still stops at the bound with exit `6`; an iteration with no edits still stops with exit `4` (tests).
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: the edited-but-unticked iteration now gets a bounded tick retry; uncommitted ticks count as progress.
- `v2/docs/v1-behaviors.md`: record the bounded tick-retry and the uncommitted-ticks-are-progress rule.
- `v2/spec/wip-intents/no-progress-stop-spares-green-work.md`: remove once landed.

## Out of scope

- The completion fix-up loop bound (separate, [[completion-commit-checkfix-output]] — that one is fix-up iterations staying red; this is implementation iterations not ticking).
- Harness auto-ticking acceptance criteria (explicitly excluded).
- Changing the patch prompt's ticking instructions beyond what the retry needs.

## Prerequisites

- The edited-but-unticked single-iteration stop is reproducible (this session, every multi-subspec spec's first run).
- `bun run typecheck` and `bun run test` green on `main`.
