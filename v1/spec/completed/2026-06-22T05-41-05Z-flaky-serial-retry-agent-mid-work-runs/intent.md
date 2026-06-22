---
name: flaky-serial-retry-agent-mid-work-runs
---

# Flaky serial-retry covers only the ready gate, not the agent's mid-work suite runs

## Problem

`2026-06-21T16-22-19Z-flaky-tests-serial-retry-and-determinism` (seed 3) made the **ready gate**
re-run a failed suite serially once before declaring red — good flaky-resilience at the gate. But
the agent itself runs `bun run test` **directly, mid-work** (observed this session on the test-audit
doc-only subspec): codex ran the full suite, hit a parallel-load flaky test, and **blocked (exit 7)**
before ever reaching the gate. The gate's serial-retry never applied — the flake false-blocked the
run mid-iteration. Same flake class, different code path, no protection.

## Direction

Close the gap so a parallel-load flake doesn't false-block mid-work. Options (pick/compose):

- **Broaden serial-retry to every suite run the harness controls**, not just the final gate — if the
  harness shells the suite anywhere in an iteration, apply the same serial-in-isolation re-run before
  treating red as real.
- **Instruct doc-only subspecs not to run the suite at all** (patch-rules guidance): a docs-only
  change has no behavior to test, so a full `bun run test` is pure flake exposure with no signal.
- Consider both: the rule reduces unnecessary runs; serial-retry covers the runs that remain.

## Out of scope

- The ready-gate serial-retry itself — already shipped (seed 3); this extends its reach.
- De-flaking specific tests (that's [[unblock-test-suite-audit-flaky-watchdog-test]] / the #15
  DI-seam work) — this is general resilience to *any* flake, not a per-test fix.

## Documentation updates

- `v1/src/modes/patch/rules.md` — if adding the doc-only "don't run the suite" guidance.
- `v2/docs/v1-behaviors.md` — where serial-retry applies (gate vs mid-work).

## References

- `v2/spec/completed/2026-06-21T16-22-19Z-flaky-tests-serial-retry-and-determinism` (the gate
  serial-retry to extend).
- Evidence: test-audit doc-only subspec, codex ran the suite mid-work and blocked exit 7 on the
  flaky `watchdog_descendants_alive` test (`v1/test/run.test.ts`).

## Prerequisites

none
