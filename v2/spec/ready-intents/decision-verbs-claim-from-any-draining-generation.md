---
name: decision-verbs-claim-from-any-draining-generation
---

# Pipeline decision verbs claim from any live draining generation

Unsplit rationale: both fixes (decision-verb claim in `createStablePipelineDecisionHandlers`, prefix resolution in `pipeline-daemon-resolution.ts`) live in the stable daemon's request handling; one surface.

## Primary implementation surface

- `v2/src/daemon/` stable-daemon pipeline decision request handling

## Prerequisites

## Problem

`approve`/`reject`/`resume`/`recover` claim a pipeline only from the stable daemon's direct predecessor. With three generations alive, a pipeline owned by the oldest refuses `pipeline_no_live_owner` until it drains (observed ~30 min, pipeline `6ae6acfa`, 2026-09-21). While any predecessor drains the listing is `degraded`, so a prefix refuses `pipeline_id_set_incomplete`.

## Decisions

- A decision verb claims from whichever live draining generation owns the pipeline, not only the direct predecessor.
- Ownership transfer stays one atomic claim per pipeline; no cross-socket fan-out of the verb (only the verb-free `pipeline_owner` witness query is sent to peers).
- Owner discovery: the stable endpoint queries `pipeline_owner` on each live adopted outgoing generation's private endpoint (the discovered `daemon-<key>.sock` peers) and claims only from the one whose `{ kind: "owner", ownerIdentity }` matches the row's recorded `ownerIdentity`. No match, unreachable owner, or owner not draining refuses `pipeline_no_live_owner`, unchanged.
- Prefix resolution stays a hint: the verb acts on the resolved full id, and the claim still needs the owner witness above. Residual risk accepted: a second match visible only to an unlisted (unreachable) generation resolves as unique.
- Prefix resolution against a `degraded` listing resolves when the prefix matches exactly one listed pipeline; ambiguous still refuses.

## Acceptance criteria

- [ ] A test with three generations (owner two back from stable) proves `approve` claims and applies without waiting for the owner to exit; it fails against the direct-predecessor-only claim.
- [ ] A test proves an unreachable or non-matching owner still refuses `pipeline_no_live_owner`.
- [ ] A test proves a unique prefix resolves against a `degraded` listing and an ambiguous one still refuses; it fails against the pre-fix resolution.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Stable endpoint claims before running a decision verb; `v2/docs/operator-runbook.md` § Stable-address pipeline control verbs; `v2/docs/v1-behaviors.md` "Pipeline control identity" entry (degraded-listing prefix refusal changes).
