# Flaky serial-retry: cover mid-work suite runs, not just the ready gate

repo: cbrenner04/jarvis

Seed-3 serial-retry covers only the ready gate. The agent runs `bun run test`
mid-work and harness blocker-validation runs the suite at base-ref / after
snapshot update — none of those serial-retry, so a parallel-load flake
false-blocks (observed: codex exit 7 on `watchdog_descendants_alive` mid-work).
Close the gap on both code paths.

- [ ] [00 - Serial-retry harness-controlled suite runs (base-ref + snapshot retest)](./00-harness-suite-run-serial-retry.md)
- [ ] [01 - Patch-rules: doc-only subspecs skip the suite; serial-retry before blocking on a test flake](./01-patch-rules-doc-only-and-serial-retry.md)
