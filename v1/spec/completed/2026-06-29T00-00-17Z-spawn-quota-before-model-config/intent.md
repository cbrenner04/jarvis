---
name: spawn-quota-before-model-config
---

# Quota classification wins when stderr also matches model-config patterns

## Problem

`spawn.ts` classifies non-zero exits in order transient → auth → **model_config → quota**.
When stderr carries both a genuine usage-limit quota signal and incidental
config-error-looking noise (e.g. codex `shell_snapshot validation failed … syntax
error near unexpected token '('` alongside `You've reached your usage limit`), the
`model_config` branch wins and masks quota. Downstream cascades that only advance
on `quota` never try the next agent.

## Direction

When diagnostics match both a per-agent strict quota pattern and a
`model_configuration` pattern, spawn classifies **`quota`**, not `model_config`.
Genuine model-id misconfiguration with no quota signal stays `model_config`.

## Decisions

- Quota precedes model_config in spawn classification when both could match — rules out keeping `model_config → quota` order for co-occurring signals.
- Fix at spawn only (reorder or equivalent), not by widening `shouldAdvance` — rules out coupling classification precedence to cascade policy in this intent.
- Narrowing `modelConfigurationPatterns` alone is insufficient unless it also fixes co-occurring quota+noise — rules out pattern-only fix that leaves precedence wrong for future noise.

## Out of scope

- Plan/patch/review/prompt cascade `shouldAdvance` policy.
- Fixing the operator shell rc syntax that triggers codex snapshot warnings.

## Documentation updates

- `v1/docs/quota-signals.md` — classification order and matrix row for co-occurring signals.
- `v1/docs/agent-cli-failure-pipeline.md` — spawn precedence list.
- `v2/docs/v1-behaviors.md` — spawn classification order note.

## Prerequisites
