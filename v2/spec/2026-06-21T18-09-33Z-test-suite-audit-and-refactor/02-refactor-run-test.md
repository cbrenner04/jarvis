# 02 - Refactor run.test.ts determinism

## Problem

`v1/test/run.test.ts` is the heaviest offender (~6.9k lines): it matches `Date.now`, `exec`,
`setTimeout`, `sleep`, and `spawn`. The prior flaky-test work widened a watchdog timeout to
4000ms — a wall-clock dependence that is itself a smell. Isolate this file so its determinism
refactor gets dedicated review without dragging the rest of the suite.

This subspec is scoped to the **named timing/process assertion groups** carrying the
wall-clock/spawn smell — early-interrupt, elapsed-bound, descendant-capture — not the entire
file. Limiting scope keeps the change within the reviewability budget; assertions outside these
groups are untouched. If converting any of these groups would exceed a reviewable PR or hits
irreducible real-clock/process coverage, route that remainder to a `*.sandbox-unrunnable.test.ts`
sibling rather than stretch one PR.

## Decisions

- Scope = the early-interrupt, elapsed-bound, and descendant-capture assertion groups only; other `run.test.ts` assertions are out of scope. Rules out a big-bang rewrite of a 6.9k-line file that blows the reviewability budget.
- Drive the watchdog/iteration-timeout assertions through an injected clock and poller instead of real timeouts, removing the 4000ms wall-clock allowance. Rules out keeping a load-sensitive sleep that re-flakes under CPU pressure.
- Route process interaction through the existing injected-spawn / `DescendantTracker` seams (`v1/src/modes/patch/reap.ts`) rather than real spawn. Rules out a real-process integration test that can't run in the sandbox.
- Preserve every existing assertion's intent (early-interrupt, elapsed bounds, descendant capture); convert the timing basis, not the contract. Rules out dropping coverage to simplify.
- If genuinely un-fakeable real-clock/process coverage remains, split it into a sibling `*.sandbox-unrunnable.test.ts` with justification rather than weakening the agent-runnable file. Rules out leaving a non-deterministic case in the default suite.

## Task checklist

- [ ] Apply the 00 `refactor` plan for `run.test.ts`: inject clock/poller and spawn seams.
- [ ] Remove the widened real timeout; assert via injected time.
- [ ] Move any irreducible real-OS case to a marked-exception sibling file.
- [ ] Record in `v2/docs/v1-behaviors.md` only a seam that alters an observable default; test-only optional params defaulting to the real impl need no entry.

## Acceptance criteria

- [ ] In the early-interrupt, elapsed-bound, and descendant-capture assertion groups, `v1/test/run.test.ts` stays green (behavior unchanged) with no real process spawn, no `Date.now`/`sleep`/`setTimeout`-based timing, and no wall-clock timeout allowance — timing is driven by an injected clock/poller. Assertions outside these groups are unchanged.
- [ ] Early-interrupt, elapsed-bound, and descendant assertions remain present and pass.
- [ ] Any irreducible real-OS coverage lives in a `*.sandbox-unrunnable.test.ts` sibling with a justification comment; nothing non-deterministic remains in the agent-runnable file.
- [ ] No `run` production behavior changes beyond additive, default-preserving DI seams; any seam that alters an observable default is recorded in `v2/docs/v1-behaviors.md` (test-only optional params defaulting to the real impl need no entry).
- [ ] `bun run test` and `bun run typecheck` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record any DI seam that alters an observable default, or note none added (additive test-only params defaulting to the real impl are not recorded).
