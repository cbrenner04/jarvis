# 03 - Update operator-facing usage docs

## Problem

After the shared helper and both agent integrations land, the operator-facing docs and telemetry descriptions will be stale unless they describe estimated usage for opencode and aider, the no-price behavior for aider and unpriced opencode models, and the narrowed opencode unavailable notice semantics.

## Decisions

- Documentation updates are limited to files that currently describe these agents as having no usage data: `docs/agents.md` and `docs/run-loop.md`.
- `docs/config.md` stays out of scope unless implementation discovers a concrete stale statement there.
- The doc changes should explain that opencode pricing depends on the configured model string matching an existing `data/prices.json` row.
- Runtime tests belong to the helper, opencode, and aider subspecs that introduce those behaviors. This subspec is documentation-only so it can be reviewed and landed independently after the code changes exist.

## Task Checklist

- [ ] Update `docs/agents.md` for opencode and aider usage-accounting behavior.
- [ ] Update `docs/run-loop.md` for telemetry source descriptions and the opencode unavailable notice behavior.

## Documentation updates

- [ ] `docs/agents.md` must stop describing successful opencode runs as always unavailable and must stop describing aider as `no-usage` when estimation succeeds.
- [ ] `docs/run-loop.md` must describe `estimated` usage and cost-source outcomes accurately for opencode and aider, including the narrowed opencode notice semantics.

## Acceptance criteria

- [ ] `docs/agents.md` describes opencode as using estimated prompt/stdout token counts and notes that cost depends on a matching configured model string in `data/prices.json`.
- [ ] `docs/agents.md` describes aider as recording estimated usage volume while typically remaining `cost_source: "no-price"` for local-model runs.
- [ ] `docs/run-loop.md` documents `estimated` usage and cost-source behavior for opencode and aider and no longer says every successful opencode run is unavailable.
- [ ] `docs/run-loop.md` documents that the opencode unavailable notice only applies when estimation falls back to unavailable usage, not on normal successful estimated runs.
