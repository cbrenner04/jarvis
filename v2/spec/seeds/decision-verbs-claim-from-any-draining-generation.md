---
name: decision-verbs-claim-from-any-draining-generation
---

# Pipeline decision verbs refuse while the owner is older than the direct predecessor

## Problem

`approve`/`reject`/`resume`/`recover` claim a pipeline only from the stable daemon's direct predecessor (`createStablePipelineDecisionHandlers`). Two `v2/src`/`shared` merges while lanes are live leave three generations alive; a pipeline owned by the oldest refuses `pipeline_no_live_owner` until that generation drains every run it admitted, which can take an hour. While a predecessor drains, the listing is `degraded`, so an 8-char prefix also refuses (`pipeline_id_set_incomplete`) and only the full id reaches the verb.

## Evidence (2026-09-21)

- Pipeline `6ae6acfa` approve-plan gate refused `pipeline_no_live_owner` for ~30 min (13 attempts) with daemons `41235` (owner, 29 min), `41601`, `23080` (stable, `loaded=01dd789`) alive after merges #4136 and #4142. The operator abandoned the pipeline and ran its implement as a standalone workflow.
- Prefix `6ae6acfa` refused `pipeline_id_set_incomplete` in the same window; the full id reached the verb.

## Decisions

- A decision verb claims from any live draining generation that owns the pipeline, not only the direct predecessor; rules out waiting on a full multi-generation drain.
- Ownership transfer stays a single atomic claim per pipeline; no cross-socket fan-out of the verb itself.
- Prefix resolution against a `degraded` listing resolves when the prefix matches exactly one listed pipeline; rules out refusing on degradation alone.

## Acceptance criteria

- [ ] A test with three generations (owner two back from stable) proves `approve` claims and applies without waiting for the owner to exit; it fails against the direct-predecessor-only claim.
- [ ] A test proves a unique prefix resolves against a `degraded` listing and an ambiguous one still refuses.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Stable endpoint claims before running a decision verb; `v2/docs/operator-runbook.md` § Stable-address pipeline control verbs.
