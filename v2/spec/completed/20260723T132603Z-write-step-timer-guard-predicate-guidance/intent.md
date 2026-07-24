---
name: write-step-timer-guard-predicate-guidance
---

# Write step instructs timer-callback guard predicate extraction

Inline guards inside `setInterval`/`setTimeout` callbacks stall implement runs: mutation
verification demands both-direction kill tests, while the determinism guard forbids the
obvious real-timer test in agent-runnable daemon/execution suites.

## Decisions

- Teach the write/implement step to prefer a pure exported predicate over an inline guard inside a timer/interval callback; rules out weakening either gate.
- Prompt/rule change only; rules out exempting timer-callback lines from mutation or allowing real timers in determinism-guarded suites.
- Pin with a test that the rule text appears in the rendered implement write-step prompt and fails against the pre-fix prompt; rules out doc-only guidance.
- Land second in the three-intent sequence (fixture → write-step guidance → dual-constraint errors) — same seam, plan and run serially. This intent owns the `v2/docs/test-writing.md` § Deterministic daemon and execution tests rule line; the fixture intent owns the worked example and the dual-constraint intent owns operator-runbook § Gate trust.

## Acceptance criteria

- [ ] A test asserts the rendered implement write-step prompt instructs extracting a guard inside a timer/interval callback into a pure, exported predicate testable in both directions without a real timer; it fails against the pre-fix prompt.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` and `scripts/guard-deterministic-daemon-tests.test.ts` stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` § Deterministic daemon and execution tests — extract timer-callback guards into pure predicates so mutation verification and the determinism guard are both satisfiable.

## Prerequisites

- The diff-derived mutation verifier flips operator/guard tokens on changed code lines.
- `scripts/guard-deterministic-daemon-tests.ts` forbids real-timer waits in agent-runnable daemon/execution tests.
