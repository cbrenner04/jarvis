# 01 Run commands use only the stable socket

## Problem

`v2/src/commands/run.ts`'s `runListSubcommand` and `resolveRunOwnerSocket` (backing `run log`) call `queryDaemonListsFromSockets`, which discovers every live digest-keyed socket via `discoverLiveDaemonSockets` and merges the results; `run log` then connects directly to whichever socket that merge names as owner. `run pause`/`resume`/`kill`/`wait` already connect only to `deps.socketPath`.

Pipeline verbs are already stable-socket-only (`v2/src/commands/pipeline.ts`'s `withStablePipelineClient`, `v2/src/daemon/pipeline-daemon-resolution.ts`'s `queryStablePipelineList`/`resolvePipelineIdAcrossDaemons`): no discovery, no per-verb fallback. `queryPipelineListsFromSocketPaths` in that same module is a daemon-internal helper consumed only by `v2/src/daemon/daemon-stable-run-routing.ts` (the stable daemon's own predecessor-merge query), not a client concern — unchanged, excluded from this subspec's and the structural guard's scope.

## Decisions

- `run list` queries only `deps.socketPath`; drop `queryDaemonListsFromSockets` and the cross-socket merge.
- `run log` streams from the stable socket only; drop `resolveRunOwnerSocket`'s owner lookup and the direct connect to a discovered owner socket — every generation shares `state/logs.jsonl` (see Prerequisites), so the stable daemon can serve any run's log without knowing which generation executed it.
- No per-verb fallback discovery when the stable daemon lacks a route: surface the daemon's own error.
- `run.test.ts` cases pinning cross-socket owner lookup (e.g. "run log streams a run owned by a non-invoking live daemon") are rewritten to the stable-socket contract, not kept as parallel cases.
- `pipeline.ts` and `pipeline-daemon-resolution.ts` are unchanged; this subspec's pipeline acceptance criterion is preservation-only.

## Acceptance criteria

- [ ] A command test proves `run list` reports only the stable daemon's run rows, with no cross-socket discovery or merge; it fails against the pre-fix `queryDaemonListsFromSockets` call in `v2/src/commands/run.ts`.
- [ ] A command test proves `run log` streams a draining-owned run's log by connecting only to the stable socket, with no owner lookup or direct connect to another socket; it fails against the pre-fix `resolveRunOwnerSocket` cross-daemon lookup in `v2/src/commands/run.ts`.
- [ ] `v2/src/commands/run.test.ts`, `v2/src/commands/pipeline.test.ts`, `v2/src/commands/run-list-dimension-filters.test.ts`, and `v2/src/commands/run-list-query-limit-cap.test.ts` stay green (pipeline verbs are unchanged by this subspec).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `run list`/`run log` route through the stable socket only.
- `v2/docs/operator-runbook.md` — remove digest-rotation/superseded-daemon/cross-project-merge-hazard language tied to `run list`/`run log`'s cross-socket merge (pipeline verbs' equivalent language is already updated).
- `v2/docs/v1-behaviors.md` — replace the `run list`/`run log` cross-socket-merge behavior entries with the stable-socket contract.
