---
name: scope-v2-ready-tests-from-run-base
---

# Scope v2 ready tests from the run base

## Prerequisites

- Shared CI scope classification maps changed paths to surface test scripts and falls back to full scope when the base cannot resolve.
- The ready script accepts `JARVIS_READY_TEST_SCOPE` independently of `JARVIS_READY_TIER`.

## Behavior

- V2 completion derives changed paths from the run's known base ref and runs only the matching ready-gate test scripts.
- The full ready tier remains active; only its test step is scoped.
- An unresolvable base runs the full aggregate test suite.

## Decisions

- Thread the run's `baseRef` into ready finalization; rules out assuming `main` or rediscovering the base from git config.
- Diff `<baseRef>...HEAD` inside the completed run's worktree; rules out caller-supplied changed paths.
- Reuse `classifyChangedPaths` and `resolveCiTestScope`; rules out a v2-only classifier.
- Pass the resolved scope as `JARVIS_READY_TEST_SCOPE` beside `JARVIS_READY_TIER=full`; rules out narrowing the ready tier.
- Treat diff failure as unresolved-base full scope; rules out failing finalization before the authoritative gate runs.

## Out of scope

- Change `JARVIS_READY_TIER` semantics; rules out weakening non-test gate steps.
- Change v1 ready-gate wiring; rules out refactoring the already-scoped v1 path.

## Documentation updates

- `v2/docs/write-behavior.md` — base-scoped ready test behavior and full-tier boundary.
- `v2/docs/operator-runbook.md` — Gate trust scope and unresolved-base fallback.
- `v2/docs/v1-behaviors.md` — v1/v2 ready-test scoping parity.
