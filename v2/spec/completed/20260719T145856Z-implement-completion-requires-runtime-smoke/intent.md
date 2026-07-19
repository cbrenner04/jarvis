---
name: implement-completion-requires-runtime-smoke
---

# Implement completion requires a runtime smoke

Mutation-sensitive tests still do not prove that changed production behavior is
wired into its runnable surface. Require bounded execution through the real
entrypoint before a runnable implementation can report `completed`.

## Decisions

- Exercise the real changed entrypoint and observe its behavior; rules out a test helper or runner invoked directly in the smoke body.
- Treat a failed or timed-out smoke as a completion failure with the command and failed observation named; rules out hiding runtime evidence behind a generic red gate.
- Treat an explicit no-runnable-surface result as a passing smoke check and record the inspected changed paths and discovery reason; rules out silently skipping smoke discovery.
- Keep smoke execution bounded and non-destructive; rules out an open-ended or state-mutating production probe.
- Run smoke verification after mutation verification passes in the mandatory implement completion path; rules out optional review or operator convention as the last no-op defense.

## Out of scope

- Broad end-to-end coverage unrelated to the changed runnable surface.
- Replacing the ready gate or mutation verification.

## Prerequisites

- Implement completion completes mutation verification before runtime-smoke discovery.

## Documentation updates

- `v2/docs/workflow-runner.md` — runtime-smoke ordering and failure settlement.
- `v2/docs/write-behavior.md` — runnable-surface, observation, bound, and not-runnable evidence contracts.
- `v2/docs/operator-runbook.md` — delete the manual green-gate and mutation-review stopgap.
- `v2/docs/v1-behaviors.md` — record the completed v2 adversarial verification guarantee.
