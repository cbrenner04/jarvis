---
name: cursor-cost-measurement-spike
---

# Spike: can cursor per-run cost be measured from the CLI?

Investigate whether the cursor CLI exposes real token usage for a single jarvis
invocation — persisted session/usage artifacts (compare
`v1/src/agents/codex-session.ts`) or stdout/`--json`/usage flags — without
post-hoc dashboard export.

Deliver a durable verdict: measurable CLI path (name artifact/flag and
correlation approach) or ruled out with evidence. No adapter behavior change
in this intent.

Record cursor cost provenance implications in `v2/docs/v1-behaviors.md`
(measured-if-found vs estimated-only). Note operator finding that Cursor
dashboard CSV export carries per-event token counts (reference:
`.scratch/cursor-usage-events-2026-06-27.csv`) only as correlation context,
not as a implemented reconciliation path.

## Decisions

- Spike scope is per-run CLI measurability during `jarvis run`, not dashboard CSV import — rules out shipping export reconciliation as the spike outcome.
- Deferred to first consumer: jarvis-run ↔ dashboard-export token correlation — pin when a caller needs it.

## Out of scope

- Adapter or telemetry code changes.
- Pricing, segmentation, or imputed-notional behavior.

## Prerequisites
