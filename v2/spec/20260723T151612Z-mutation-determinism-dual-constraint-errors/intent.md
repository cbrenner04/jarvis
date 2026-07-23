---
name: mutation-determinism-dual-constraint-errors
---

# Mutation–determinism conflict errors name both constraints

When a changed guard sits inside a timer callback, `surviving_mutation_failed` names only
mutation coverage while the determinism guard silently forbids the obvious real-timer test.
Neither error references the other constraint.

## Decisions

- Trigger: dual-constraint naming fires whenever mutation verification fails on a changed line inside a timer/interval callback in a file the determinism guard covers — not only on a rare unrefactorable case; rules out a refactorability check the verifier cannot perform.
- Error site: the existing `surviving_mutation_failed` operator-facing failure message, extended in place; rules out a new failure code or a separate diagnostic channel.
- Message shape: names the mutation requirement (both-direction kill test on the changed line), names the determinism-guard prohibition (no real-timer wait in that suite), and points at predicate extraction as the fix; rules out a bare mutation message that hides why the obvious test is rejected.
- Do not weaken either gate; rules out exempting timer-callback lines from mutation or allowing real timers in determinism-guarded suites.
- Land after `timer-callback-guard-extraction-fixture` and `write-step-timer-guard-predicate-guidance` — same seam, plan and run serially. This intent owns `v2/docs/operator-runbook.md` § Gate trust; siblings do not edit it.

## Acceptance criteria

- [ ] A regression test drives a mutation failure on a changed line inside a timer callback in a determinism-guarded file and asserts the operator-facing error names both the mutation requirement and the determinism-guard prohibition; it fails against the pre-fix code.
- [ ] A mutation failure outside a timer callback keeps the current single-constraint message.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` and `scripts/guard-deterministic-daemon-tests.test.ts` stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — cross-constraint failures name both gates and the predicate-extraction fix.

## Prerequisites

- The diff-derived mutation verifier flips operator/guard tokens on changed code lines.
- `scripts/guard-deterministic-daemon-tests.ts` forbids real-timer waits in agent-runnable daemon/execution tests.
