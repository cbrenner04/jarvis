# Bounded tick-retry on edited-but-unticked iterations

## Problem

The implementation-path stop at `v1/src/modes/patch/iteration.ts` ~`:854-867` returns exit `6` the *first* time an iteration edits files, ticks no new acceptance criterion (`newlyChecked.length === 0` and not `allChecked`), and leaves a dirty worktree (`worktreeCompletionBlocker !== undefined`). When the agent finished a subspec's work in one turn but ended before ticking, the work is green and the only gap is the ticks — yet the operator must re-run jarvis purely so the agent ticks, ~doubling the agent cost of every single-iteration subspec.

Deadlock variant: if a prior run ticked the boxes *in the subspec file* but stopped before committing them, the next run snapshots `beforeCriteria` from the already-ticked file (`iteration.ts` ~`:418-423`), so the agent's edits produce no *new* tick → exit `6` again. The uncommitted ticks can never commit without manual intervention.

This subspec gives the edited-but-unticked outcome a bounded number of additional iterations to tick before exiting `6`, and treats uncommitted ticks present at iteration start as progress (commit + re-evaluate) so a re-run cannot deadlock. The true no-progress stop (exit `4`, no edits) and the fix-up/blocker paths are untouched.

## Two mechanisms, one outcome

Both facets live in the same `runIteration` region and the exit-6 outcome is what they jointly defuse, so they ship together:

1. **Bounded retry** — replace the immediate exit `6` at `:854-867` with a loop-back (`state.iteration += 1; return { kind: "continue" }`) until a per-subspec consecutive-count reaches `N`, then exit `6` as today.
2. **Uncommitted-ticks-are-progress** — at iteration start, if the active subspec's working-tree acceptance criteria carry ticks the committed (HEAD) version lacks, commit them and re-evaluate completion before the agent runs, so a re-entered subspec advances instead of re-detecting no-progress.

## Decisions

- Replace the immediate exit `6` on the edited-files/no-new-AC/dirty branch with a bounded retry: increment a per-active-subspec consecutive counter and loop back; when it reaches `N`, exit `6` as today. Rules out an unbounded retry that lets a non-ticking agent spin (and riding `maxIterations` instead of a dedicated bound).
- `N = 2` consecutive edited-but-unticked iterations on the same active subspec before exit `6`. `> 1` gives the agent at least one extra turn to tick; small keeps a stuck agent cheap. Rules out `N = 1` (no retry, today's behavior) and a large `N` that wastes turns. Pin exact value at implementation; default candidate `N = 2`.
- The retry counter is **consecutive and per-active-subspec**: reset to 0 on any AC progress (new tick / completion), on a blocker, and when the active subspec path changes. Rules out a run-global counter that trips across unrelated subspecs and one that never resets so the second occurrence on a different subspec stops early.
- Retries consume normal iterations and count against `maxIterations`; no separate hidden iteration budget. Rules out a side budget that lets the run exceed the operator's `maxIterations` ceiling.
- At iteration start (before spawning the agent), detect ticks present in the active subspec's working tree but absent from its committed HEAD version; commit them as progress and re-evaluate completion (finish the spec if now fully checked, else proceed). Rules out only diffing against the last committed state after the agent runs — which is exactly what lets already-ticked-but-uncommitted ACs read as no-progress and deadlock.
- The harness never auto-ticks on the agent's behalf — the retry only declines to give up after one turn; the agent still owns every tick (consistent with the existing harness-cannot-judge-criteria rule). Rules out the harness ticking acceptance criteria itself.
- The no-edits no-progress stop (exit `4`, `iteration.ts` ~`:966-992`), the blocker paths (exit `7`), and the completion fix-up loop (exit `10`) are unchanged. Rules out widening this into the genuinely-stuck, blocker, or completion-gate cases.

## Retry trace (the contract)

Active subspec, agent edits each turn but ticks nothing, `N = 2`:

```
iter1  edited, no new tick, dirty → count=1 (<2) → loop back
iter2  edited, no new tick, dirty → count=2 (=N) → stop, exit 6
```

A ticking agent breaks out: if iter2 ticks a satisfied AC, the existing `newlyChecked.length > 0` / `allChecked` path commits and the count resets — the run finishes in the same invocation, no operator re-run.

## Task checklist

- Add a per-active-subspec consecutive edited-but-unticked counter to `IterationContext["state"]` (`v1/src/modes/patch/run.ts` ~`:93-108`), initialized in `runCommand` (~`:226-233`); track the subspec path it applies to so it resets when the active subspec changes.
- In the edited/no-new-AC/dirty branch (`iteration.ts` ~`:854-867`): increment the counter and loop back (`state.iteration += 1; return { kind: "continue" }`) while `< N`; at `N`, emit the existing exit-6 message and return `6`.
- Reset the counter to 0 on the `allChecked` and `newlyChecked.length > 0` paths and whenever the active subspec path differs from the tracked one.
- At iteration start, after resolving the active subspec, diff working-tree ACs against committed HEAD ACs; if the working tree has extra ticks, commit them (reuse `commitWipProgress` / `commitSubspec` as the completion state dictates), re-evaluate completion, and proceed — do not fall into the no-progress branch on those ticks.
- Tests (fake agent + `runCompletionReadyGate`/git seams): tick-on-second-turn completes in one run; never-ticks stops at exit `6` at the bound (not iter1); re-entered subspec with uncommitted ticks commits and proceeds; no-edits still exits `4`.
- Docs: `v1/docs/run-loop.md`, `v2/docs/v1-behaviors.md`; remove `v2/spec/wip-intents/no-progress-stop-spares-green-work.md`.

## Acceptance criteria

- [ ] An iteration that edits files and ticks no new acceptance criterion on an otherwise-green tree no longer exits `6` on the first occurrence; the run loops back and a fake agent that ticks the satisfied criteria on its second turn completes the spec in the same invocation (exit `0`, no operator re-run) (test).
- [ ] A fake agent that edits files but never ticks stops with exit `6` only after the bound (`N` consecutive edited-but-unticked iterations on the same subspec), not on the first occurrence; the test fixes `N < maxIterations` so the bound, not the loop ceiling, is what stops it (test).
- [ ] The edited-but-unticked counter is consecutive and per-active-subspec: an AC tick (progress) between two edited-but-unticked iterations resets it (test).
- [ ] A subspec whose acceptance criteria are ticked in the file but uncommitted at iteration start has those ticks committed and is advanced (completed or progressed) rather than re-detecting no-progress / exiting `6` (test).
- [ ] An iteration with no edits and no new tick still stops with exit `4`; blocker (exit `7`) and completion fix-up (exit `10`) paths are unchanged (their existing tests stay green) (test).
- [ ] The harness never ticks acceptance criteria itself — the retry only re-prompts; a run where the agent never ticks ends with the subspec's criteria still unticked in the file (test).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md` (exit-code table row for `6` ~`:726`): the edited-files/no-new-AC/dirty case now gets a bounded tick-retry (`N` consecutive same-subspec occurrences) before exiting `6` rather than stopping on the first; uncommitted ticks present at iteration start are committed and counted as progress.
- `v2/docs/v1-behaviors.md` (exit-code mapping ~`:326` and the patch tick/no-progress behaviors ~`:327-330`): record the bounded tick-retry on edited-but-unticked iterations and the uncommitted-ticks-are-progress rule; note retries count against `maxIterations` and the harness still never auto-ticks.
- `v2/spec/wip-intents/no-progress-stop-spares-green-work.md`: remove once landed.
