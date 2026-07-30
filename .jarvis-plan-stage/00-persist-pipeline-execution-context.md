# Persist pipeline execution context

## Problem

- Pipeline rows omit the admission context used by stage resolution, so a later stage cannot be rebuilt after
  the admitting process exits.

## Decisions

- Persist the admitted `PipelineContext` as an immutable JSON snapshot on the pipeline row; rules out rebuilding
  later-stage input from workflow rows or the continuing client.
- Load pre-context pipeline rows with no context rather than synthesizing one; rules out guessing admission input
  during migration.

## Task checklist

- Add a forward migration and typed pipeline context persistence to the state store.
- Pass daemon `pipeline_start` admission context into `createPipeline`.
- Add focused persistence, admission-wiring, and migration coverage.
- Update the durable persistence and daemon admission docs.

## Acceptance criteria

- [ ] Closing and reopening the store preserves the complete immutable admitted `PipelineContext`; mutating the
      caller's source context after admission does not change the stored snapshot.
- [ ] Context loaded after the admitting store closes is sufficient for `resolveStageWorkflowSteps` to resolve a
      later workflow stage using the persisted predecessor artifact, without caller-supplied admission input.
- [ ] Daemon `pipeline_start` persists the supplied context with the admitted definition before returning the
      pipeline ID.
- [ ] A database from before the context migration opens successfully and loads legacy pipeline context as absent.
- [ ] New or updated regressions in `v2/src/persistence/state-store.test.ts` and
      `v2/src/daemon/daemon-pipeline-start.test.ts` for context persistence and admission wiring fail against the
      pre-fix behavior.
- [ ] Inverting any added context-presence or legacy-fallback guard makes its targeted regression fail; negative
      cases prove absent legacy context is not synthesized.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/state-store.md` and `v2/docs/daemon-host.md` document persisted admission context in their
      respective persistence and daemon-admission homes.

## Documentation updates

- `v2/docs/state-store.md` — context schema, migration, snapshot, and repository contract.
- `v2/docs/daemon-host.md` — `pipeline_start` persists context before returning admission.
