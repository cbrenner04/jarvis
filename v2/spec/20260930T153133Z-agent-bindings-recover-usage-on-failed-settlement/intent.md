---
name: agent-bindings-recover-usage-on-failed-settlement
---

# Agent bindings recover token usage on failed settlement

## Problem

Claude, cursor, opencode, and codex finalize paths return early on non-`ok` settlement without reading retained NDJSON stdout or correlated codex session rollouts, so partial or terminal usage is discarded before telemetry runs.

## Behavior

On quota, stall, error, model_config, idle stall, and abort teardown, each binding best-effort recovers the latest authoritative input, output, cache-read, and cache-write counters from the buffered stream or uniquely matched session rollout before settling, without delaying settlement or reclassifying the exit. Cumulative stream events use the terminal authoritative snapshot, not repeated sums across the same counters. When only partial counters exist, populate the optional usage fields on the settled non-ok result with explicit provenance (warnings and/or `usage_source`) and list-price `computeCost` when `priceKey` and fields allow; when recovery fails, leave usage null. Recovery errors surface as warnings only.

## Acceptance criteria

- [ ] Injected stream and codex-session fixtures in `shared/invocation` binding tests prove usage survives non-ok exit and abort teardown, cumulative events are not double-counted, fallback attempts keep separate usage, missing counters stay null, and both a pre-result failure with no usage and a failure after partial usage are covered; no ambient agent sessions or machine config; fails against pre-fix bindings that settle non-ok without stream or rollout recovery.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — adapter recovery on non-ok settlement, partial usage, and bounded teardown behavior.
- `v2/docs/v1-behaviors.md` — recovered usage on failed agent settlement before telemetry.

## Prerequisites
