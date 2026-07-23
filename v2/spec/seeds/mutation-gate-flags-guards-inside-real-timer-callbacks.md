# The mutation gate flags guards the determinism guard forbids testing conventionally

## Problem

Two harness mechanisms pull in opposite directions on a guard that lives inside a real
`setInterval`/`setTimeout` callback:

- The diff-derived mutation verifier flips the guard and demands a test that kills the mutation in
  both directions.
- `scripts/guard-deterministic-daemon-tests.ts` forbids real-timer waits in the agent-runnable
  daemon/execution suites, so the natural test — arm the interval, advance the clock, assert the
  effect — is rejected at `bun run check`.

The implementer is squeezed: cover the guard and fail the determinism guard, or satisfy the
determinism guard and fail the mutation gate. Neither error names the other constraint.

Observed 2026-07-23 on `retire-superseded-daemon-when-idle` (implementation otherwise complete and
CI-green, PR #2015). The idle-exit guard `shutdownRequested || (isRetiring() && !hasActiveRuns())`
sat inside a 100ms `setInterval` in `startDaemonRuntime` (`v2/src/daemon/daemon.ts`). Three
successive runs stalled `surviving_mutation_failed` on `!hasActiveRuns → hasActiveRuns` at that line;
resumes did not close it because the agent could not write a passing timer test. The operator
resolved it by hand: extract the decision into a pure `shouldShutdownNow(shutdownRequested,
isRetiring, hasActiveRuns)` predicate and pin all four cases without a timer.

The fix pattern — hoist the predicate out of the timer callback into a pure exported function — is
mechanical and always available. The agent does not discover it, so every guard authored inside a
timer callback risks the same multi-run stall.

## Decisions

- Teach the write/implement step to prefer a pure predicate over an inline guard inside a
  timer/interval callback, so the mutation gate and the determinism guard can both be satisfied;
  rules out weakening either gate, both of which were correct here.
- The guidance is a prompt/rule change, not a code change to either gate; rules out exempting
  timer-callback lines from mutation (which would silently drop real coverage) and rules out
  allowing real timers in the determinism-guarded suites.
- Where the two gates genuinely conflict on a line that cannot be refactored, the error the operator
  sees should name both constraints; rules out a bare `surviving_mutation_failed` that hides why the
  obvious test is rejected.

## Acceptance criteria

- [ ] The write-step guidance instructs extracting a guard inside a timer/interval callback into a
      pure, exported predicate the test can pin both directions without a real timer; a test asserts
      the rule text is present in the rendered write-step prompt.
- [ ] A regression fixture demonstrates the pattern: a guard inside a `setInterval` callback, its
      extracted pure predicate, and a both-direction test that passes `bun run check` (no real timer)
      and would kill the operator-flip mutation.
- [ ] The determinism guard and the mutation verifier are both unchanged in behavior; existing tests
      for each stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — extract timer-callback guards into pure predicates so both the mutation
  gate and the deterministic-daemon-test guard are satisfiable; show the `shouldShutdownNow` shape.
- `v2/docs/operator-runbook.md` § Gate trust — a `surviving_mutation_failed` on a timer-callback
  guard is closed by hoisting the predicate, not by a real-timer test.

## Prerequisites

- The diff-derived mutation verifier flips operator/guard tokens on changed code lines.
- `scripts/guard-deterministic-daemon-tests.ts` forbids real-timer waits in agent-runnable
  daemon/execution tests.
