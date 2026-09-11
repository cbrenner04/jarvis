---
name: route-draining-pipelines-through-stable-daemon
---

# Route draining pipelines through the stable daemon

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.
- The stable daemon exposes each draining-generation run as live and routes run observation, waits, logs, and controls to its authoritative owner.

## Module-boundary surface

- Daemon pipeline ownership and request routing: pipeline snapshots, identifier resolution, owner selection, control verbs, and stage workflow dispatch across draining generations.

## Problem

Pipeline listing, prefix resolution, and the seven ownership-sensitive control verbs (`wait`, `approve`, `reject`, `resume`, `recover`, `dismiss`, `undismiss`) currently discover and compare keyed daemon sockets. An absent invoking-version socket makes the pipeline id set incomplete, while a superseded owner can make a healthy pipeline unroutable as `pipeline_no_live_owner`.

## Behavior

- The stable daemon exposes one complete pipeline namespace: `list` and prefix resolution read it directly, and each of the seven ownership-sensitive verbs (`wait`, `approve`, `reject`, `resume`, `recover`, `dismiss`, `undismiss`) routes to the generation owning the relevant live workflow, so source changes do not affect identifiers or control. `start` admission stays out of scope here — it is always handled by the incoming generation.

## Decision ledger

- Resolve full ids and prefixes once against the stable daemon's unified durable namespace; rules out completeness depending on any invoking-version socket.
- Return one canonical pipeline snapshot per id from the stable address while preserving current derived-state and dismissal semantics.
- Route `wait`, `approve`, `reject`, `resume`, `recover`, `dismiss`, and `undismiss` behind the stable address; rules out clients probing `pipeline_owner` across version endpoints.
- Keep successor dispatch on the incoming generation while routing decisions for a draining live stage to its authoritative owner; rules out duplicate stage progression.
- Preserve exact-id, ambiguity, terminal-state, and genuinely ownerless refusal contracts independent of daemon generation.

## Acceptance criteria

- [ ] A regression test proves a prefix printed by `pipeline list` resolves after a source change when no invoking-version socket exists; it fails against the pre-fix completeness predicate.
- [ ] Tests prove each of the seven verbs (`wait`, `approve`, `reject`, `resume`, `recover`, `dismiss`, `undismiss`) reaches a pipeline whose live stage is owned by a draining generation through the stable address, without `pipeline_no_live_owner` caused by supersession.
- [ ] A test proves pipeline snapshots from incoming and draining work are deduplicated behind the stable address with unchanged derived state and dismissal behavior.
- [ ] A concurrency test proves one pipeline stage continues under its draining owner while a successor stage is admitted only once by the correct generation.
- [ ] Tests preserve ambiguous-prefix, unknown-id, terminal-state, and genuinely ownerless refusals without consulting public generation sockets.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — unified pipeline namespace and generation-transparent verb routing.
- `v2/docs/pipeline-execution.md` — stage ownership across daemon handoff and single-admitter progression.
- `v2/docs/v2-architecture.md` — stable-front-door pipeline routing boundary.
- `v2/docs/v1-behaviors.md` — record generation-transparent pipeline listing, prefix resolution, and control.
