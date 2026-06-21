# Bounded tick-retry on edited-but-unticked iterations

## Problem

The implementation-path stop at `v1/src/modes/patch/iteration.ts` ~`:854-867` returns exit `6` the *first* time an iteration edits files, ticks no new acceptance criterion (`newlyChecked.length === 0` and not `allChecked`), and leaves a dirty worktree (`worktreeCompletionBlocker !== undefined`). That branch fires purely on **edited files + dirty worktree + no new tick** — the harness has no notion of test/correctness "greenness" and cannot tell "done but unticked" from "broken and not done." When the agent finished a subspec's work in one turn but ended before ticking, the only gap is the ticks — yet the operator must re-run jarvis purely so the agent ticks, ~doubling the agent cost of every single-iteration subspec. The retry's safety comes from the **bound** (a stuck agent still stops, just at `N` instead of 1), not from any greenness guarantee the harness cannot make.

Deadlock variant: if a prior run ticked the boxes *in the subspec file* but stopped before committing them, the next run snapshots `beforeCriteria` from the already-ticked file (`iteration.ts` ~`:418-423`), so the agent's edits produce no *new* tick → exit `6` again. The uncommitted ticks can never commit without manual intervention.

This subspec gives the edited-but-unticked outcome a bounded number of additional iterations to tick before exiting `6`, and treats uncommitted ticks present at iteration start as progress (commit + re-evaluate) so a re-run cannot deadlock. The true no-progress stop (exit `4`, no edits) and the fix-up/blocker paths are untouched.

**Deliberately not split.** The two mechanisms ship as one subspec because they break each other if separated: the bounded retry, alone, would re-deadlock on its own uncommitted ticks across the retry turns (each retry re-snapshots the already-ticked file as `beforeCriteria`); the uncommitted-ticks-fix is what lets a retry actually make progress. Splitting would leave the first-landed half broken.

## Two mechanisms, one outcome

Both facets live in the same `runIteration` region and the exit-6 outcome is what they jointly defuse, so they ship together:

1. **Bounded retry** — replace the immediate exit `6` at `:854-867` with a loop-back (`state.iteration += 1; return { kind: "continue" }`) until a per-subspec consecutive-count reaches `N`, then exit `6` as today.
2. **Uncommitted-ticks-are-progress** — at iteration start, if the active subspec's working-tree acceptance criteria carry ticks the committed (HEAD) version lacks: commit them, re-evaluate completion, and **loop back without spawning the agent this turn** (`state.iteration += 1; return { kind: "continue" }`) — or finish the spec if the commit makes it fully checked. Looping back before the agent runs is what closes the exit-4 hole: committing does not change the working-tree file that `beforeCriteria` snapshots, so falling through to the post-agent diff would yield `after === before` and drop a partially-completing re-entry into exit `4`. Never reaching that diff on the committed-ticks turn avoids it.

## Decisions

- Replace the immediate exit `6` on the edited-files/no-new-AC/dirty branch with a bounded retry: increment a per-active-subspec consecutive counter and loop back; when it reaches `N`, exit `6` as today. Rules out an unbounded retry that lets a non-ticking agent spin (and riding `maxIterations` instead of a dedicated bound).
- `N = 2` consecutive edited-but-unticked iterations on the same active subspec before exit `6`. `> 1` gives the agent at least one extra turn to tick; small keeps a stuck agent cheap. Rules out `N = 1` (no retry, today's behavior) and a large `N` that wastes turns.
- When `N ≥ maxIterations`, the loop ceiling can terminate the run (its own exit code) mid-retry before the bound trips, so an input that exits `6` today may exit on the ceiling instead. Accepted — the operator's `maxIterations` ceiling is authoritative and retries are not exempt from it.
- The retry counter is **consecutive and per-active-subspec**: reset to 0 on any AC progress (new tick / completion) and when the active subspec path changes. Rules out a run-global counter that trips across unrelated subspecs and one that never resets so the second occurrence on a different subspec stops early.
- The counter is inert during fix-up iterations (`activeSubspecPath` undefined): it neither increments nor resets, so the fix-up loop does not disturb it. Rules out fix-up turns spuriously advancing or clearing the retry count.
- Retries consume normal iterations and count against `maxIterations`; no separate hidden iteration budget. Rules out a side budget that lets the run exceed the operator's `maxIterations` ceiling.
- At iteration start (before spawning the agent), detect ticks present in the active subspec's working tree but absent from its committed HEAD version; commit them as progress, re-evaluate completion, and loop back without spawning the agent this turn (finish the spec if now fully checked). Rules out only diffing against the last committed state after the agent runs — which is exactly what lets already-ticked-but-uncommitted ACs read as no-progress and deadlock — and rules out falling through post-commit into the exit-4 branch.
- A subspec absent from HEAD (new file not yet committed) is treated as "no committed ticks": every working-tree tick is then extra and gets committed as progress. Rules out a diff that errors or skips when the committed version does not exist.
- The start-of-iteration tick commit reuses the existing commit helpers (`commitWipProgress` / `commitSubspec`), which stage with `git add -A`; it therefore sweeps any other in-progress edits in the worktree, not only the tick. Accepted as consistent with every other commit on this path — no tick-only staging carve-out. Rules out implying a tick-scoped commit the helpers do not provide.
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
- Reset the counter to 0 on the `allChecked` and `newlyChecked.length > 0` paths and whenever the active subspec path differs from the tracked one; leave it untouched on fix-up iterations (`activeSubspecPath` undefined).
- At iteration start, after resolving the active subspec, diff working-tree ACs against committed HEAD ACs (treat absent-at-HEAD as no committed ticks); if the working tree has extra ticks, commit them (reuse `commitWipProgress` / `commitSubspec` as the completion state dictates — `git add -A` scope accepted), re-evaluate completion, and loop back without spawning the agent this turn — never falling through to the post-agent diff on those ticks.
- Tests (fake agent + `runCompletionReadyGate`/git seams): tick-on-second-turn completes in one run; never-ticks stops at exit `6` at the bound (not iter1); re-entered subspec with uncommitted ticks commits and advances at `maxIterations = 1`, including a partial-tick case (committed ticks complete the spec only partially); no-edits still exits `4`.
- Docs: `v1/docs/run-loop.md`, `v2/docs/v1-behaviors.md`; remove `v2/spec/wip-intents/no-progress-stop-spares-green-work.md`.

## Acceptance criteria

- [x] An iteration that edits files and ticks no new acceptance criterion (dirty worktree) no longer exits `6` on the first occurrence; the run loops back and a fake agent that ticks the satisfied criteria on its second turn completes the spec in the same invocation (exit `0`, no operator re-run) (test).
- [x] A fake agent that edits files but never ticks stops with exit `6` only after the bound (`N` consecutive edited-but-unticked iterations on the same subspec), not on the first occurrence; the test fixes `N < maxIterations` so the bound, not the loop ceiling, is what stops it (test).
- [x] The edited-but-unticked counter is consecutive and per-active-subspec: an AC tick (progress) between two edited-but-unticked iterations resets it (test).
- [x] A subspec whose acceptance criteria are ticked in the file but uncommitted at iteration start has those ticks committed and is advanced — and this recovery holds at `maxIterations = 1` (no retry budget), covering both a partial-tick re-entry (committed ticks complete the spec only partially, run proceeds) and a fully-completing re-entry (commit finishes the spec) — rather than re-detecting no-progress and exiting `4` or `6` (test).
- [x] An iteration with no edits and no new tick still stops with exit `4`; blocker (exit `7`) and completion fix-up (exit `10`) paths are unchanged (their existing tests stay green) (test).
- [x] The harness never ticks acceptance criteria itself — the retry only re-prompts; a run where the agent writes **zero** ticks anywhere (so the test cannot conflate "committed the agent's ticks" with "harness auto-ticked") ends with the subspec's criteria still unticked in the file and the run stopped at the bound (test).
- [x] `bun run typecheck` and `bun run test` pass.

