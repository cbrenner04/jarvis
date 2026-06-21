---
name: test-suite-audit-and-refactor
---

# Audit and refactor the existing test suite

## Parked (2026-06-21) — chicken-and-egg on the flaky watchdog test

Planned (6 subspecs: audit → 01-05 refactor batches; spec on main at
`v2/spec/2026-06-21T18-09-33Z-test-suite-audit-and-refactor/`) but the run **blocked at the
audit subspec**: the agent (codex) ran the full `bun run test` during the doc-only audit, hit the
**flaky `watchdog_descendants_alive` timing test** (the very kind of test this seed refactors —
it passes 7/0 in isolation, flakes under `--parallel`), and raised exit-7. Chicken-and-egg: the
audit can't get green until the flaky test it's meant to fix is stabilized. Resume in a fresh
session by either (a) stabilizing that watchdog test first (the #15 DI-seam pattern, = subspec
02's job — do it standalone first), or (b) instructing the audit subspec not to run the full
suite (it's doc-only). Note: seed 3's gate serial-retry does **not** help here — the agent ran
`bun run test` directly, not through the ready gate.


## Problem

The test corpus has grown to ~86 files / ~30k LOC across `v1`, `v2`, `shared`, and `test`, and
this session exposed that parts of it are non-deterministic, sandbox-unrunnable, or brittle —
flaky process-timing tests false-blocked work repeatedly (#15 de-flaked only two), and ~32 test
files reach for real process spawning or wall-clock/timing primitives. This is a backward-looking
remediation of what already exists, distinct from the harness-behavior + convention work in
[[flaky-tests-serial-retry-and-determinism]] (which defines the standard this audit refactors
toward). Do this **after** that convention lands so the audit has a fixed target.

## Direction

Grounding-first (survey before refactoring — the discipline that paid off all session):

1. **Audit** the corpus and produce findings, categorized by smell:
   - non-determinism: real process spawn (`spawn`/`execFile`/`exec`), wall-clock / `Date.now` /
     `setTimeout` / sleep dependence, ordering- or parallelism-sensitivity;
   - sandbox-unrunnable tests (anything the coding agent can't execute);
   - over-mocking / brittleness, redundancy (duplicate coverage), and slow tests.
2. **Refactor** toward the determinism convention (DI seams, injected tables, no real process
   spawn) so every agent-runnable test is deterministic and sandbox-safe; drop or merge redundant
   tests; keep coverage at/above current thresholds.

Scope the refactor to mechanical correctness-preserving changes — no behavior changes to the code
under test. Suite stays green throughout; this is large enough that the audit findings should
drive an explicitly sequenced set of subspecs rather than one big-bang change.

## Out of scope

- The gate serial-retry behavior and the determinism *convention* itself — those are
  [[flaky-tests-serial-retry-and-determinism]]; this consumes them.
- Changing production behavior to make code testable beyond introducing DI/test seams.

## Documentation updates

- `v2/docs/coding-standards` / test-writing guidance — codify the determinism rules the refactor
  enforces, so new tests don't reintroduce the smells.

## References

- `v2/spec/2026-06-20T21-30-42Z-stabilize-flaky-process-timing-tests/` (#15, #329) — the DI-seam /
  injected-table pattern to apply broadly.
- Smell inventory starting point: the ~32 `*.test.ts` files matching
  `spawn|execFile|exec(|setTimeout|Date.now|sleep|new Date(` under `v1`/`v2`/`shared`.
