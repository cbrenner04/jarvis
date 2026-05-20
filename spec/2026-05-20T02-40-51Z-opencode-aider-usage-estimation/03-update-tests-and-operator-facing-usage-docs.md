# 03 - Update tests and operator-facing usage docs

## Problem

After the shared helper and both agent integrations land, the operator-facing docs and telemetry descriptions will be stale unless they describe estimated usage for opencode and aider, the no-price behavior for aider and unpriced opencode models, and the narrowed opencode unavailable notice semantics.

## Decisions

- Documentation updates are limited to files that currently describe these agents as having no usage data: `docs/agents.md` and `docs/run-loop.md`.
- `docs/config.md` stays out of scope unless implementation discovers a concrete stale statement there.
- The doc changes should explain that opencode pricing depends on the configured model string matching an existing `data/prices.json` row.
- Tests in this subspec focus on the new estimated-usage behaviors and fallback warning semantics that span the shared helper and both agent integrations.

## Task Checklist

- [ ] Update `docs/agents.md` for opencode and aider usage-accounting behavior.
- [ ] Update `docs/run-loop.md` for telemetry source descriptions and the opencode unavailable notice behavior.
- [ ] Add or extend tests so the new estimated-usage and fallback cases are locked in at the unit level.

## Documentation updates

- [ ] `docs/agents.md` must stop describing successful opencode runs as always unavailable and must stop describing aider as `no-usage` when estimation succeeds.
- [ ] `docs/run-loop.md` must describe `estimated` usage and cost-source outcomes accurately for opencode and aider, including the narrowed opencode notice semantics.

## Acceptance criteria

- [ ] Tests cover shared-helper success with zero cache fields and helper `null` fallback.
- [ ] Tests cover opencode success attaching estimated usage and allowing downstream pricing to resolve from the configured model string.
- [ ] Tests cover aider success attaching estimated usage while remaining `cost_source: "no-price"` with no price key.
- [ ] Tests cover estimator failure on both agents preserving the current `usage_source: "unavailable"` and `cost_source: "no-usage"` fallback with warnings.
- [ ] `docs/agents.md` describes opencode as using estimated prompt/stdout token counts and notes that cost depends on a matching configured model string in `data/prices.json`.
- [ ] `docs/agents.md` describes aider as recording estimated usage volume while typically remaining `cost_source: "no-price"` for local-model runs.
- [ ] `docs/run-loop.md` documents `estimated` usage and cost-source behavior for opencode and aider and no longer says every successful opencode run is unavailable.
- [ ] `docs/run-loop.md` documents that the opencode unavailable notice only applies when estimation falls back to unavailable usage, not on normal successful estimated runs.
