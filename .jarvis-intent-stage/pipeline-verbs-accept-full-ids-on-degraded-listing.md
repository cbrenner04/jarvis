---
name: pipeline-verbs-accept-full-ids-on-degraded-listing
---

# Pipeline verbs accept full ids against a degraded listing

Unsplit rationale: One CLI-admission seam — stable-address id resolution in `resolvePipelineIdAcrossDaemons` before any verb RPC; CLI and resolver tests plus operator docs prove the same operator-visible behavior.

## Problem

After daemon self-handoff, `pipeline list` stays `degraded` for minutes. Full-UUID `pipeline approve|resume|dismiss` then refuses `pipeline_id_set_incomplete`, contradicting the runbook claim that exact listed ids work on a degraded listing. `resolvePipelineIdAcrossDaemons` only accepts an exact id when `ids.includes(argument)`; omitted predecessor rows make full UUIDs fall into the degraded prefix refusal.

## Decisions

- A well-formed full pipeline id (UUID shape) bypasses listing membership and prefix resolution; the verb RPC refuses `unknown_pipeline` if absent.
- Prefix resolution against a malformed, unavailable, or degraded listing still refuses `pipeline_id_set_incomplete` before any verb RPC.

## Acceptance criteria

- [ ] A CLI test with a degraded listing that omits the target proves a full UUID argument reaches the verb RPC unchanged; it fails against the pre-fix code.
- [ ] A CLI test proves an 8+-char prefix against a degraded listing still refuses `pipeline_id_set_incomplete` before any verb RPC.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Stable-address pipeline control verbs: full UUIDs skip listing resolution; only prefixes need a healthy listing.
- `v2/docs/v1-behaviors.md` — pipeline control identity entry: full UUID arguments bypass degraded-listing gating; prefix rules unchanged.

## Prerequisites

## Primary implementation surface

- `v2/src/daemon/pipeline-daemon-resolution.ts`
