---
name: route-pipeline-verbs-to-draining-owner
---

# Route pipeline verbs to a draining owner

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.
- The stable daemon exposes each draining-generation run as live and routes run observation, waits, logs, and controls to its authoritative owner.
- The stable daemon answers `pipeline list` and pipeline-id prefix resolution from one namespace merging its direct predecessor's pipelines, with one canonical snapshot per id and no per-socket completeness requirement.

## Problem

Since #3863 a dead owner's pipeline is adopted, so supersession no longer strands a pipeline terminally. While the owner is still draining, though, `wait`, `approve`, `reject`, `resume`, `recover`, `dismiss`, and `undismiss` cannot reach it through the stable address and must wait for the owner to exit and adoption to occur. Removes a bounded wait; deferrable.

## Behavior

- Each of the seven ownership-sensitive verbs routes behind the stable address to the generation owning the pipeline's live stage; clients no longer probe `pipeline_owner` across version endpoints.
- Successor stage dispatch stays on the incoming generation; a draining live stage's decisions go to its owner, ruling out duplicate stage progression.
- Genuinely ownerless refusals preserved; `start` admission out of scope.

## Acceptance criteria

- [ ] Tests prove each of `wait`, `approve`, `reject`, `resume`, `recover`, `dismiss`, `undismiss` reaches a pipeline whose live stage is owned by a draining generation through the stable address, without `pipeline_no_live_owner` caused by supersession.
- [ ] A concurrency test proves one stage continues under its draining owner while the successor stage is admitted exactly once by the incoming generation.
- [ ] A test preserves the genuinely ownerless refusal without consulting public generation sockets.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — generation-transparent verb routing.
- `v2/docs/pipeline-execution.md` — stage ownership across handoff and single-admitter progression.
- `v2/docs/v1-behaviors.md` — generation-transparent pipeline control.
