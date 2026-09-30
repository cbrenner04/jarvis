---
name: pipeline-decision-claim-misses-older-draining-generation
---

# Stable decision verbs claim through a terminal `durable_state` owner witness

Unsplit rationale: peer witness acceptance, stable decision-verb claim wiring, regression tests, and operator docs all live on the stable pipeline decision claim path in `daemon-stable-run-routing.ts`; `pipeline_owner` wire shape and CLI dispatch are unchanged.

## Primary implementation surface

- `v2/src/daemon/daemon-stable-run-routing.ts` stable pipeline decision claim routing

## Prerequisites

- Stable pipeline decision verbs discover live peer generations and authorize `claimPipelineContinuation` when a peer's `pipeline_owner` answers `{ kind: "owner", ownerIdentity }` matching the row's recorded owner.
- A peer's `pipeline_owner` answers `{ kind: "durable_state", state, ownerIdentity }` for an `active` row whose derived execution state is terminal (and for reconciled `interrupted` rows), with terminal classification before live ownership.

## Problem

`claimPipelineForDecision` only treats a peer's `pipeline_owner` answer as confirmation when `kind` is `owner`. A draining generation holding an `active` row whose derived state is already `failed` answers `durable_state` instead, so the stable endpoint refuses `pipeline_no_live_owner` even though the owner process is reachable on its private socket.

## Decisions

- A peer answering `durable_state` whose `ownerIdentity` matches the row's recorded owner confirms ownership for the claim, same as `owner`; `claimPipelineContinuation` stays the guard.
- `not_owner`, `not_found`, and unreachable peers still refuse.
- No new verb or flag; `pipeline_owner` wire shape unchanged.

## Acceptance criteria

- [ ] A regression in `v2/src/daemon/daemon-stable-run-routing.test.ts` proves `pipeline_resume` (stable handlers) claims and runs when a fake peer answers `{ kind: "durable_state", state: "failed", ownerIdentity }` matching the row owner; it fails against the owner-only witness check.
- [ ] A regression in the same file proves a matching `durable_state` witness with a mismatched `ownerIdentity` still refuses `pipeline_no_live_owner`.
- [ ] A regression in the same file proves a peer answering `not_owner` or being unreachable still refuses `pipeline_no_live_owner`.
- [ ] `describe("stable pipeline decision-verb claim across older generations")` owner-witness claim tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Stable endpoint claims before running a decision verb — a terminal-state witness from the recorded owner confirms the claim.
- `v2/docs/operator-runbook.md` § Stable-address pipeline control verbs — drop waiting for the owning daemon to exit when a failed pipeline is still held by a draining generation.
