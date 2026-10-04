---
name: timer-callback-guard-extraction-fixture
---

# Timer-callback guard extraction ships a regression fixture

The hoist pattern — extract an inline timer-callback guard into a pure exported predicate
and pin both directions without a real timer — is mechanical but not discoverable from
gates alone. Without an in-repo fixture, agents repeat multi-run `surviving_mutation_failed`
stalls on timer-callback guards.

## Decisions

- Ship a new synthetic teaching fixture: an inline `setInterval` guard, its extracted pure predicate, and both-direction unit tests. Production already carries the pattern (`shouldShutdownNow` in `v2/src/daemon/daemon.ts`, pinned by `v2/src/daemon/daemon-retire-superseded.test.ts`); rules out canonizing production code as the fixture and rules out touching the daemon.
- Executable proof is both-direction predicate tests that pass `bun run check` with no real timer, so flipping the predicate's operator fails them; rules out a doc-only example, and rules out running the diff-derived mutation verifier against the fixture as an acceptance step.
- Leave mutation verification and the determinism guard unchanged; rules out bundling gate behavior changes with the fixture.
- Land first in the three-intent sequence (fixture → write-step guidance → dual-constraint errors) — same seam, plan and run serially. This intent owns the `v2/docs/test-writing.md` worked-example section; siblings do not edit it.

## Acceptance criteria

- [ ] A new fixture demonstrates a guard inside a `setInterval` callback and its extracted pure predicate, with tests covering both truth directions of the predicate; the tests fail if the predicate's comparison is inverted.
- [ ] The fixture's tests pass `bun run check` and complete without waiting on a real timer.
- [ ] `v2/src/daemon/daemon-retire-superseded.test.ts`, `v2/src/execution/diff-derived-mutation-verifier.test.ts`, and `scripts/guard-deterministic-daemon-tests.test.ts` stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — worked example of the fixture's extract-and-pin pattern, citing `shouldShutdownNow` as the production instance.

## Prerequisites

- The diff-derived mutation verifier flips operator/guard tokens on changed code lines.
- `scripts/guard-deterministic-daemon-tests.ts` forbids real-timer waits in agent-runnable daemon/execution tests.
