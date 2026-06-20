---
name: shrink-tooling-ladder-config
---
# Shrink tooling-first ladder with config off switch

**Scope.** Post-completion shrink phase, `modes.patch.shrink` config, shrink contract guards.

## Problem

Shrink always runs an agent and re-runs `bun run test` after completion ready even when shrink made no changes. No config to skip shrink entirely (`modes.review.passes: 0` only skips review).

## Desired behavior

Shrink stays after green completion ready and before review. Config `modes.patch.shrink`: `off` | `tooling` | `agent` | `both` (default `both` during transition; document `off` for inner-loop). Deterministic pre-pass: `check:fix` on allowlist + diff-stat gate. Agent shrink only when tooling is a no-op and bloat heuristics still match. Skip `bun run test` when shrink produced no file changes; otherwise unchanged guards (AC regression, no deleted scoped tests). `off` skips the phase entirely.

## Decisions

- Tooling pre-pass runs before agent shrink in `both` mode. Rules out agent-first shrink when deterministic fixes are available.
- Agent shrink invoked only when tooling is a no-op and bloat heuristics match. Rules out unconditional agent shrink after every completion.
- No file changes from shrink skips the shrink test re-run. Rules out always re-running `bun run test` after a no-op shrink.
- `off` skips shrink entirely without affecting review placement. Rules out requiring `modes.review.passes: 0` to skip shrink.

## Acceptance signals

- Tests prove each config value (`off`, `tooling`, `agent`, `both`) selects the expected shrink path.
- Tests prove tooling pre-pass runs `check:fix` on allowlist and respects diff-stat gate.
- Tests prove no file changes skips shrink test re-run; file changes retain AC regression and scoped-test guards.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: shrink modes, tooling ladder, `off` inner-loop guidance.
- `v2/docs/v1-behaviors.md`: shrink phase config and contract behavior.

## Out of scope

- Review debate topology.
- Changing shrink prompt diff caps (patch routing intent).
- Moving shrink before completion ready.

## Prerequisites

- Harness exposes callable fast and full ready tiers for shrink contract test skipping.
