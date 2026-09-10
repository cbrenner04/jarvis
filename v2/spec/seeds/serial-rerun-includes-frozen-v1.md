---
name: serial-rerun-includes-frozen-v1
---

# Serial failure confirmation must exclude frozen v1

## Problem

AGENTS.md requires a bare `bun test` after a scoped failure, while also forbidding testing frozen `v1/`. The 2026-09-10 hand burn-down followed the serial instruction: Bun discovered `v1/test/**`, including imports of the retired `assemblePromptForStep` export and tests for the deleted `bin/jarvis1`. That rerun cannot serve as a trustworthy confirmation of the live engine’s gate.

## Decisions

- Define one serial failure-confirmation command covering every live test surface and excluding frozen v1.
- Keep confirmation serial and preserve the union of v2, shared, root-test, and root-tooling surfaces.
- Update agent instructions and operator docs to use that command; retain failing-test evidence and avoid declaring failures real solely from the frozen tree.

## Documentation updates

- `AGENTS.md` — replace the conflicting bare serial rerun instruction.
- `v2/docs/operator-practices.md` and `v2/docs/operator-runbook.md` — document the live-surface serial confirmation command.
