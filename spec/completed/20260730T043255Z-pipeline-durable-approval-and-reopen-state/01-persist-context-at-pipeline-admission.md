# Persist context at pipeline admission

## Problem

- `pipeline_start` can admit a definition without making its supplied context durable first.

## Decisions

- Persist the supplied context with the definition in the admission transaction before returning a pipeline ID;
  rules out a client-side retry or reconstructed context after partial admission.

## Task checklist

- Wire daemon `pipeline_start` context into pipeline creation.
- Add focused admission coverage.
- Update daemon-admission docs.

## Acceptance criteria

- [x] Daemon `pipeline_start` persists the supplied immutable context with the admitted definition before returning
      the pipeline ID.
- [x] A new or updated `v2/src/daemon/daemon-pipeline-start.test.ts` regression for admission-context persistence
      fails against the pre-fix daemon behavior.
- [x] Inverting the admission-context handoff guard makes its targeted regression fail; the negative case proves no
      pipeline ID is returned for an admission that lacks durable context.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/daemon-host.md` documents that `pipeline_start` durably records context before admission succeeds.
- [x] `v2/docs/v1-behaviors.md` records the additive v2 durable-admission behavior.

## Documentation updates

- `v2/docs/daemon-host.md` — admission ordering and durable context.
- `v2/docs/v1-behaviors.md` — additive v2 durable admission.
