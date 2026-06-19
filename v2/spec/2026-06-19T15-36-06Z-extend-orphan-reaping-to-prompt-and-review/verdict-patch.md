# Verdict — Refinements Required

The implementation delivers the core behavior (reuse `DescendantTracker`, poll + reap in `finally`, non-fatal failures) and satisfies the happy-path wiring. Several gaps remain between spec decisions, acceptance criteria, patch-mode teardown parity, and what tests actually prove. Address the following before treating the spec as complete.

## Required outcomes

1. **Prompt mode must use a per-attempt tracker, not a run-spanning one.** Subspec 00 rules out a single tracker across the fallback loop; each agent attempt is a discrete invocation with its own `finally` reap. The current hoist-before-loop contradicts that decision and diverges from review's per-invocation pattern. After correction, tracked state must not carry across attempts unless a survivor genuinely outlives its attempt.

2. **Review teardown must match patch/prompt: final snapshot before reap.** Both review spawn sites (reviewer pass and verdict actuator) currently clear the poll interval and reap without a final `poll` on the spawn root PID. Patch and prompt take one last snapshot after stopping the interval and before reaping — the gap that matters most after a process-group kill scatters descendants between the last interval tick and teardown. Review must close that gap on both paths.

3. **Tests must prove spawn + interval polling, not only that reap ran.** The first acceptance criterion in each subspec requires polling on spawn and on the interval, observed via the injected override. `FakeAgent` never invokes `onSpawned`, so current tests exercise only the reap call. New or updated tests must demonstrate that polling is wired (e.g. by driving `onSpawned`, asserting poll side effects through the override or a test seam, or observing `trackedCount` before reap).

4. **Prompt mode must have a test covering the watchdog-timeout exit branch.** Subspec 00 names watchdog-timeout as the highest-value reap target and includes it explicitly in acceptance criteria. A test must show reap runs and exit code/reason remain `8` / `watchdog-iteration-timeout` when the watchdog fires.

5. **The verdict-actuator reaping test must prove the actuator's `finally` fired, not merely that some review invocation reaped.** A passing `reapCalls.length > 0` with adversary/advocate passes upstream is insufficient. The test must distinguish actuator reaping from reviewer-pass reaping (minimum call count, call-index tracking, or prompt/role discrimination in the override).

6. **Resolve the unspec'd outer-`finally` reap in prompt mode.** Prompt currently reaps again after lock release in the outer `finally`; subspec 00 does not require this, and prompt has no patch-style `finalize` / `process.exit` escape path that would justify it. Either remove it (preferred if no real bypass exists) or document the rationale in durable docs. This choice determines correct reap-count expectations in tests.

7. **Tighten prompt success-path test expectations once outcome 6 is settled.** `toBeGreaterThanOrEqual(1)` can pass with only the outer reap. Pin the expected reap count that matches the final tracker scope and teardown design so per-attempt wiring is unambiguous.

8. **Durable docs must describe the shipped behavior accurately.** `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md` currently describe per-attempt prompt tracking that the code does not implement, and omit the outer-`finally` reap if it remains. Align docs with the final tracker scope and teardown sequence from outcomes 1, 2, and 6.

## Rationale

Outcomes 1–2 restore fidelity to explicit spec decisions and patch-mode teardown parity — the production goal of catching post-kill escapees. Outcomes 3–5 discharge acceptance criteria the subspecs' verification story promises but tests do not yet prove. Outcomes 6–8 prevent undocumented behavior and overstated docs from masking wiring gaps.

## Not required

- Shared polling/reap helper extraction (maintainability only; out of scope).
- Test-only override API shape differences between prompt and review (spec-driven).
- Structural test for `DESCENDANT_POLL_INTERVAL_MS` relocation (verdict plan rejected that criterion).
- Aligning actuator vs reviewer timeout/kill semantics (pre-existing).
- Actuator-path non-fatality test (same wrapper as reviewer; low risk once outcome 2 is fixed).
- Interval-poll `try/catch` alignment across modes (minor inconsistency; fix only if touching those lines).
