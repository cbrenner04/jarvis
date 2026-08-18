---
name: heavy-daemon-agent-tests-flake-under-ci-concurrency
---

# Heavy daemon/agent test files pass in isolation but fail under CI's concurrent full-suite run, red-gating nearly every PR

## Problem

Several socket/timing/subprocess-heavy v2 test files pass reliably in isolation but fail — via timeouts or racing assertions — when run concurrently with each other under load, which is exactly how CI executes the full `bun run test` suite (all files in parallel). The result: a large fraction of PRs red-gate on tests that have nothing to do with their change, and every PR needs one or more CI re-runs to go green. This is sustained toil, not an occasional blip.

Two confirmed offenders (there are likely more):

- **`v2/src/execution/workflow-runner.test.ts`** — a ~246-test "agent" file (~2 min) that sits at the CI per-file agent-test wall-clock; under a slow/loaded runner it tips into `error: "agent" test run timed out or was killed on file "v2/src/execution/workflow-runner.test.ts"`. Observed 2026-08-17 red-gating `clear-plan-draft-harness-blocker` (#2879), `route-plan-draft-contract-miss-blockers` (#2888), and `main` post-merge (13:44Z) — each passed a CI re-run with no code change.
- **`v2/src/daemon/daemon-resume.test.ts`** — 99 tests, passes 0-fail in isolation across 4 straight runs (~6s), but run concurrently with `workflow-runner.test.ts` under load it produces **106 failures / 354** (socket/timing races). Observed 2026-08-17 red-gating multiple live PRs simultaneously.

Failure rate spiked from ~4% (quiet evening) to ~44% at 04:00Z, tracking concurrent CI load plus overnight GitHub-hosted-runner variance. Both files pass reliably alone locally, confirming a concurrency/wall-clock flake, not broken tests. The existing `scripts/guard-deterministic-daemon-tests.ts` guard does not catch this — the tests are individually "deterministic" but race under shared-machine contention.

## Decisions

- Make the heavy daemon/agent test files robust under the concurrency CI actually uses. Plan picks the mechanism(s): run the socket/agent-heavy files in a **serialized (non-concurrent) lane** or test group; isolate per-test sockets/tmp so parallel files don't collide; reduce fake-agent subprocess fan-out / share fixtures; and/or raise-and-align the agent-test per-file wall-clock with margin. Rules out leaving them at the concurrency edge and re-running CI by hand.
- Fix the class, not one file: audit for the socket/timing/subprocess-heavy v2 test files (start with `v2/src/daemon/**` and `v2/src/execution/workflow-runner.test.ts`) and bring each under the chosen mechanism. Rules out a one-file patch that leaves the next file flaking.
- Preserve coverage: no test deleted or skipped to fit the clock or dodge the race; splitting/serialization/fixture-sharing keeps every assertion. Rules out trimming tests to go green.
- Verify under load, not just isolation: pin that the full suite (or the serialized lane) passes across repeated concurrent runs with margin, so a future addition that re-approaches the edge is caught. Rules out a fix that passes once and silently drifts back.

## Acceptance criteria

- [ ] The full `bun run test` / CI suite passes reliably across repeated runs with no per-file re-runs — `workflow-runner.test.ts` no longer agent-timeouts and `daemon-resume.test.ts` no longer fails under concurrent execution — pinned by a repeated-run/CI-scope check.
- [ ] The identified socket/agent-heavy files pass under concurrent load (run together, machine loaded) with a pinned margin, not only in isolation.
- [ ] Coverage is unchanged: test counts and asserted behaviors match the pre-fix files, pinned by a count/inventory check or review.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — the concurrency contract for socket/agent-heavy tests: the serialized lane (or isolation requirement), the agent-test timeout budget and margin, and when a file must join it rather than run in the default parallel pool.
