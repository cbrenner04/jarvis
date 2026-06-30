# Doc cross-links

## Problem

`v2/docs/telemetry-capture.md` is the durable home for the analysis-fact contract,
but existing v2 docs still describe only two persistence roles or omit telemetry
entirely. Cross-link updates wire the third store into architecture, build order,
step-runner, state-store, and outcome-audit docs without duplicating schema detail.

Depends on [00 - Telemetry capture reference doc](./00-telemetry-capture-reference.md).

## Decisions

- Cross-links only — rules out duplicating telemetry schema or classification tables in sibling docs.
- `v2-architecture.md` gets a third-store paragraph under Persistence/Observability — rules out a standalone telemetry architecture doc.
- `v2-build-order.md` gets a cross-cutting telemetry bullet naming doc landing and runtime emitter phase milestones — rules out folding telemetry into a numbered phase body.
- `shared-step-runner.md` gets an emission-boundary pointer — rules out inlining full emission contract in step-runner.
- `state-store.md` gets a "telemetry stays out" cross-link — rules out implying token/cost belong in SQLite.
- `outcome-data-source-audit.md` gets a forward link to the v2 capture contract — rules out rewriting the audit tables.
- Optional one-line pointer in `v2-vision.md` only if it fits an existing telemetry mention — rules out adding a new vision section for doc-only work.

## Task checklist

- [ ] `v2/docs/v2-architecture.md` — Persistence/Observability: third-store paragraph + link to `telemetry-capture.md`.
- [ ] `v2/docs/v2-build-order.md` — Cross-cutting section: telemetry bullet with doc vs runtime emitter milestones.
- [ ] `v2/docs/shared-step-runner.md` — emission-boundary pointer to `telemetry-capture.md`.
- [ ] `v2/docs/state-store.md` — cross-link confirming telemetry/token/cost stay out of orchestration SQLite.
- [ ] `v2/docs/outcome-data-source-audit.md` — forward link to v2 capture contract.
- [ ] `v2/docs/v2-vision.md` — optional one-line pointer if natural (skip if forced).

## Acceptance criteria

- [ ] `v2/docs/v2-architecture.md` links to `telemetry-capture.md` and states telemetry JSONL is a third persistence role separate from orchestration SQLite and the observability log.
- [ ] `v2/docs/v2-build-order.md` cross-cutting section includes a telemetry bullet naming doc landing and deferred runtime emitter placement.
- [ ] `v2/docs/shared-step-runner.md` points emission boundaries to `telemetry-capture.md`.
- [ ] `v2/docs/state-store.md` cross-links `telemetry-capture.md` and states token/cost streams stay out of the orchestration store.
- [ ] `v2/docs/outcome-data-source-audit.md` forward-links the v2 telemetry capture contract.
- [ ] No sibling doc duplicates telemetry schema detail from `telemetry-capture.md`.

## Documentation updates

- Cross-link edits listed above only.
- No `v2/docs/v1-behaviors.md` update: cross-links only, no v1 behavior change.
