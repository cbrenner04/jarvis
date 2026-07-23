# 00 - Ship timer-callback guard extraction fixture

## Problem

Extracting an inline timer-callback guard into a pure exported predicate and pinning both
directions without a real timer is mechanical but not discoverable from gates alone. Without an
in-repo teaching fixture, implement runs stall on `surviving_mutation_failed` when agents leave
guards inside `setInterval` callbacks.

## Decisions

- Ship a synthetic fixture under `v2/src/testing/` with its own minimal predicate and
  `setInterval` callback wiring; rules out canonizing `shouldShutdownNow` / `daemon.ts` as the
  fixture and rules out editing production daemon code.
- Predicate tests call the exported predicate directly in both truth directions; rules out
  asserting behavior by waiting for the interval to fire (forbidden by the determinism guard).
- Leave `diff-derived-mutation-verifier` and `guard-deterministic-daemon-tests` unchanged;
  rules out bundling gate behavior with the fixture.
- Acceptance proof is the fixture's unit tests only; rules out running the diff-derived mutation
  verifier against the fixture as a subspec criterion.
- This intent owns the `v2/docs/test-writing.md` worked example for the hoist pattern; sibling
  timer-callback intents edit other sections only.

## Task checklist

- [ ] Add `v2/src/testing/timer-callback-guard-fixture.ts`: a pure exported predicate plus a
      small exported helper that registers a `setInterval` callback whose body guards on that
      predicate (mirroring the `shouldShutdownNow` hoist in `daemon.ts`, with synthetic names and
      inputs).
- [ ] Add `v2/src/testing/timer-callback-guard-fixture.test.ts`: agent-runnable tests that
      exercise every predicate input combination needed for both-direction coverage without
      `Bun.sleep`, timer-backed `Promise` waits, or waiting on the interval to fire.
- [ ] Confirm the fixture tests complete under `bun run check` with no real-timer dependence.

## Acceptance criteria

- [ ] `timer-callback-guard-fixture.test.ts` covers both truth directions of the exported
      predicate and fails against the pre-fix tree; inverting the predicate's comparison operator
      makes at least one test fail.
- [ ] The fixture's tests pass `bun run check` and finish without waiting on a real timer.
- [ ] `v2/src/daemon/daemon-retire-superseded.test.ts` stays green.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` stays green.
- [ ] `scripts/guard-deterministic-daemon-tests.test.ts` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — new worked example: extract an inline `setInterval` guard into a
  pure exported predicate, test both directions without a real timer, and cite
  `shouldShutdownNow` in `daemon.ts` as the production instance.
