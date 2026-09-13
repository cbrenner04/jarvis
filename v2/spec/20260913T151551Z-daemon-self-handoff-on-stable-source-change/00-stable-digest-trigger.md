# Stable digest trigger

## Problem

No daemon-owned logic decides when the executable tree has stably diverged from the loaded digest; only a client request starts a generation.

## Decisions

- Pure controller with injected `sample(): Promise<string>`, `startHandoff(loaded, observed): Promise<"committed" | "rolled_back">`, and a timer seam; no real timers in tests — rules out interval-bound tests.
- Trigger only when the same divergent digest is seen on two consecutive samples; a loaded or different divergent sample replaces the candidate — rules out "any two divergent samples".
- Single-flight: skip sampling-triggered starts while an attempt is in flight — rules out queuing a second attempt.
- A `startHandoff` rejection (spawn error, IPC error, readiness timeout, or any other failure short of a settled outcome) is treated identically to a resolved `"rolled_back"`: the in-flight flag clears and the candidate resets — rules out a stuck in-flight state or an unhandled-rejection crash of the sampling loop.
- On `rolled_back` (resolved or via a caught rejection), clear the candidate so retry needs two fresh matching samples — rules out reusing pre-failure samples.
- Sampling failure (digest throws or resolves to `unknown`) clears the candidate and never triggers — rules out handing off on an unreadable tree.
- The timer-body guard logic is two exported pure predicates: `shouldTriggerHandoff(candidate, loadedDigest, sampledDigest)` (candidate-update vs. trigger) and `shouldSampleNow(state)` (skip a tick while an attempt is in flight) — rules out guard logic living inline in the timer callback where it can't be unit-tested without a real interval.
- Deferred to first consumer: sampling interval value — pin in 01 when wired.

## Acceptance criteria

- [ ] A unit test feeds the same divergent digest on two consecutive samples and asserts `startHandoff` is called once with loaded and observed digests; it fails against the pre-fix code where no trigger exists.
- [ ] A unit test proves one divergent sample followed by the loaded digest does not call `startHandoff`.
- [ ] A unit test proves two different divergent samples do not call `startHandoff` until one value repeats consecutively.
- [ ] A unit test proves no second `startHandoff` call occurs while the first is unresolved, even across further matching samples.
- [ ] A unit test proves after a `rolled_back` result the next single matching sample does not trigger, but two fresh matching samples do.
- [ ] A unit test proves a `startHandoff` rejection is treated the same as `rolled_back`: the in-flight flag clears, the candidate resets, one fresh matching sample does not retrigger, two fresh matching samples do, and the sampling loop keeps running with no unhandled rejection.
- [ ] A unit test proves a sample that throws or resolves to `"unknown"` clears any pending candidate and never calls `startHandoff`.
- [ ] `shouldTriggerHandoff` and `shouldSampleNow` are exported pure functions, each unit-tested in both truth directions (trigger vs. no-trigger; sample vs. skip).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None: internal building block with no consumer yet; docs land with wiring in 01.
