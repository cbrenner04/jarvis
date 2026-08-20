# Daemon dismiss/undismiss requests and default-excluding pipeline_list

## Problem

`handlePipelineListHandler` (`v2/src/daemon/daemon.ts:2147`) is parameterless and returns `store.listPipelines().map(projectPipelineSnapshot)` — every admitted pipeline, forever. The durable dismissal flag exists (`pipelines.dismissed_at`, migration `027-pipeline-dismissed-at`, `dismissPipeline`/`undismissPipeline` on `StateStore`) but nothing on the wire reaches it: no request records an operator's dismissal, the projection drops `dismissedAt`, and every client (`jarvis pipeline list`, `--json`, the TUI work tree) repaints abandoned pipelines with no way to hide one.

## Decision ledger

- The dismissed filter lives in the `pipeline_list` handler over the unfiltered `store.listPipelines()` read — rules out a store-level filtered query, which would also hide dismissed rows from `reconcilePipelines`/`claimPipelineContinuation` and strand live work (`v2/docs/state-store.md` pins the store as never filtering on `dismissed_at`).
- `pipeline_list` takes optional `includeDismissed`, opted in by strict `=== true`; absent, `false`, or any non-boolean (including a truthy one like the string `"true"`) lists non-dismissed pipelines only, with no `invalid_params` refusal — rules out type-validating the parameter, whose only effect would be refusing a request whose fail-safe reading is already the default.
- `dismissedAt` rides every projected snapshot unconditionally (`number | null`, `null` when not dismissed), not only under opt-in — rules out a conditionally present field clients would have to feature-detect, and rules out an out-of-band second lookup.
- `pipeline_dismiss` / `pipeline_undismiss` return the store's `PipelineDismissalOutcome` as the RPC `result`, matching `pipeline_approve`/`pipeline_reject`'s outcome-in-result convention — rules out `pipeline_wait`'s `unknown_pipeline` error-frame refusal, which would turn a mistyped id into an RPC error the CLI must catch rather than a value it can print.
- Idempotence is inherited from the store, not re-derived at the RPC layer: a repeat `pipeline_dismiss` on an already-dismissed pipeline returns `applied` with the original `dismissedAt` unchanged (first-writer-wins), and `pipeline_undismiss` on a never-dismissed pipeline returns `applied`; the handler passes the store's `PipelineDismissalOutcome` through verbatim, so this asymmetry is the wire contract too.
- The `applied` result additionally carries derived `state` (`derivePipelineState`), so a caller dismissing a `running` pipeline can warn; `refused` results carry no `state` — there is no pipeline row to derive one from.
- Dismissing a `running` pipeline succeeds and changes nothing but `dismissed_at`: no stage dispatch, no gate settlement, no ownership change, no `activeRuns` entry — rules out reusing the reject/kill path.
- Neither handler carries the `retiring` → `daemon_superseded` guard that `pipeline_approve`/`pipeline_reject`/`pipeline_resume`/`pipeline_recover` carry — dismissal admits no execution, so a retiring daemon has nothing to protect; rules out treating a display flag as new work.
- Missing or empty `pipelineId` → `invalid_params` before the store is touched — rules out letting the store answer `pipeline_not_found` for a request that never named a pipeline, which would report a mistyped id and an omitted id identically.
- Nothing here clears `dismissedAt`: `pipeline_resume`, `pipeline_recover`, and restart recovery can all continue to drive a dismissed pipeline, which stays out of every default `pipeline_list` listing until an operator undismisses it or opts into `includeDismissed`. This is a daemon-surface consequence of the already-landed store decision that a reopened/reconciled pipeline stays dismissed — not changed here, and unreachable from any client until the CLI intent lands.
- Every existing `pipeline_list` caller (`v2/src/commands/pipeline.ts`, `v2/src/tui/tui-daemon-client.ts`) keeps sending no parameter and silently adopts the default exclusion; per-client opt-in flags are the `dismiss-pipeline-cli` / `dismiss-pipeline-tui-display` intents' work.

## Task checklist

- Add `dismissedAt: number | null` to `PipelineSnapshot` and to `projectPipelineSnapshot` (`v2/src/daemon/pipeline-observation.ts`), sourced from the durable row.
- Add a `handlePipelineDismissalHandler("dismiss" | "undismiss")` factory in `v2/src/daemon/daemon.ts` and register `pipeline_dismiss` / `pipeline_undismiss` in `handlersOut`.
- Give `handlePipelineListHandler` its `frame`-reading `includeDismissed` opt-in and the default `dismissedAt === null` filter.
- Add `v2/src/daemon/daemon-pipeline-dismiss.test.ts` with the tests below and their in-body `// @mutate` directives on the real handler guards.
- Default `dismissedAt: null` in the `PipelineSnapshot` builder functions in `v2/src/tui/tui-attention-rows.test.ts`, `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, and `v2/src/tui/tui-monitor-lines.test.ts` (typecheck flags them on the new required field). The synthesized `Pipeline`-shaped value in `v2/src/tui/tui-monitor-lines.ts` (`snapshotHasReachableUndecidedGate`, feeding `derivePipelineBoundary` only) already sets `dismissedAt: null` and needs no change.
- Update `v2/docs/daemon-host.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/write-behavior.md`.

## Acceptance criteria

- [ ] A daemon test dismisses an admitted pipeline and asserts the next default `pipeline_list` (no params) omits it while a sibling non-dismissed pipeline is still listed; it fails against the pre-fix daemon, which has no `pipeline_dismiss` handler and lists everything.
- [ ] A daemon test asserts `pipeline_list { includeDismissed: true }` returns the dismissed pipeline with numeric `dismissedAt`, returns the non-dismissed sibling with `dismissedAt: null`, and is otherwise identical to the default projection.
- [ ] A daemon test asserts `pipeline_list { includeDismissed: "true" }` (a non-boolean truthy value) still omits the dismissed pipeline, proving the opt-in reads strict `=== true` rather than any truthy value.
- [ ] A daemon test asserts `pipeline_undismiss` returns `{ kind: "applied", pipelineId, state }` and restores the pipeline to the default (no-params) listing with `dismissedAt: null`.
- [ ] A daemon test dismisses an already-dismissed pipeline a second time and asserts the repeat `pipeline_dismiss` call also returns `{ kind: "applied", ... }` while `pipeline_list { includeDismissed: true }` still reports the original `dismissedAt` timestamp, unchanged by the repeat call.
- [ ] A daemon test asserts an unknown pipeline id is refused on both requests with `{ kind: "refused", pipelineId, reason: "pipeline_not_found" }` as the RPC `result` (not an error frame) and that a real pipeline in the same store still lists.
- [ ] A daemon test asserts an omitted `pipelineId` is refused `invalid_params` on both requests.
- [ ] A daemon test dismisses a pipeline whose workflow stage is held mid-flight, captures its stage records at that point (before dismissal), and asserts: the result is `{ kind: "applied", state: "running" }`; a `pipeline_list { includeDismissed: true }` call immediately after shows every stage record byte-identical to the captured mid-flight snapshot (`id`, `stageId`, `branchKey`, `position`, `status`, `workflowInvocationId`, `startedAt`, `endedAt`, `decidedAt`, `artifact`, `failureDetail`) with unchanged derived state; and after the in-flight step settles, the pipeline still reaches its terminal state with `dismissedAt` still set.
- [ ] `v2/src/daemon/daemon-pipeline-dismiss.test.ts` — `dismissed pipelines drop out of the default pipeline_list`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the handler's `includeDismissed || pipeline.dismissedAt === null` filter predicate to `true` (baseline: `pipeline_list` projects every stored pipeline unconditionally) turns this test red, while the unknown-id and `invalid_params` tests stay green.
- [ ] `v2/src/daemon/daemon-pipeline-dismiss.test.ts` — `includeDismissed returns dismissed pipelines with dismissedAt set`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the opt-in read `params?.includeDismissed === true` to `false` makes the opt-in call behave like the default call, turning this test red — proving the parameter genuinely widens the projection rather than the rows being listed anyway.
- [ ] `v2/src/daemon/daemon-pipeline-dismiss.test.ts` — `an unknown pipeline id is refused on dismiss and undismiss`; Mutation checkpoint: an in-body `// @mutate` directive neutering the handler's `if (outcome.kind === "refused") { return { kind: "response", result: outcome }; }` refusal return to `if (false) { return { kind: "response", result: outcome }; }` makes both requests instead proceed to `store.loadPipeline` on the unknown id and call `derivePipelineState` on the resulting `null`, throwing, rather than returning the named `pipeline_not_found` refusal — turning this test red.
- [ ] `v2/src/daemon/daemon-pipeline-dismiss.test.ts` — `a missing pipelineId is refused invalid_params on dismiss and undismiss`; Mutation checkpoint: an in-body `// @mutate` directive neutering the `pipelineId` validation to `if (false) {` makes both requests reach the store and answer `pipeline_not_found` for a request that named no pipeline, turning this test red.
- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts`, `v2/src/daemon/daemon-pipeline-start.test.ts`, `v2/src/daemon/daemon-pipeline-approval.test.ts`, and `v2/src/daemon/pipeline-execution.test.ts` stay green unmodified (no admitted pipeline is dismissed in them, so the default projection is unchanged for every existing case).
- [ ] `v2/src/tui/tui-attention-rows.test.ts`, `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, and `v2/src/tui/tui-monitor-lines.test.ts` have their `PipelineSnapshot` builder functions default the new `dismissedAt: null` field, then `bun run typecheck` and each file's own suite pass.
- [ ] `v2/docs/daemon-host.md` — the request table gains `pipeline_dismiss` and `pipeline_undismiss` rows (params, `applied`-with-`state` / `refused` result shapes, `invalid_params`, the inherited store idempotence — a repeat dismiss stays `applied` with the timestamp unchanged, undismiss-when-never-dismissed is `applied` — no `daemon_superseded` guard, and that dismissal never dispatches, settles, or changes ownership); the `pipeline_list` row plus the **Pipeline snapshots** section record the optional `includeDismissed` parameter, the strict `=== true` opt-in, the default exclusion, `dismissedAt` on every snapshot, and that durable state retains dismissed pipelines (the store and the restart sweeps still see them); and a note records that `pipeline_resume`, `pipeline_recover`, and restart recovery can still drive a dismissed pipeline, which stays out of every default listing until undismissed.
- [ ] `v2/docs/v1-behaviors.md` — a `[v2 behavior change]` entry records that daemon `pipeline_list` no longer returns every stored pipeline by default: dismissed pipelines are excluded unless the request passes `includeDismissed: true`, every snapshot carries `dismissedAt`, and the existing parameterless callers (`jarvis pipeline list`, `jarvis pipeline list --json`, the TUI multi-daemon merge) therefore stop showing dismissed pipelines; the existing `[v2 additive]` `pipeline_list` snapshot field enumeration is amended in place to add `dismissedAt`, and the `[v2 behavior change]` entry noting `--json` preserves the unmodified snapshot is amended to note the default dismissed-exclusion filter now applies ahead of that passthrough.
- [ ] `v2/docs/write-behavior.md` — the `pipeline list` row and the "List vs wait" prose are amended: the `--json` note that it mirrors daemon `pipeline_list` unmodified gains the default dismissed-exclusion, and the human-listing description notes dismissed pipelines are omitted by default (no `--include-dismissed` flag lands here; that is the `dismiss-pipeline-cli` intent's work).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_dismiss` / `pipeline_undismiss` request-table rows (including inherited store idempotence); `pipeline_list` row and **Pipeline snapshots** section updated for `includeDismissed`, default exclusion, `dismissedAt`, and the note that `pipeline_resume`/`pipeline_recover`/restart recovery can still drive a dismissed pipeline.
- `v2/docs/v1-behaviors.md` — `pipeline_list` no longer returns every stored pipeline by default; existing snapshot field enumeration and the `--json`-unmodified entry are reconciled in place.
- `v2/docs/write-behavior.md` — `pipeline list` row and "List vs wait" prose reconciled for the default dismissed-exclusion (`--json` and human listing alike).

## Implementer notes

- Suggested shape, keeping each guard independently quotable by one single-line `@mutate` directive (the quoted anchors below must each occur exactly once in `daemon.ts`):

  ```ts
  const handlePipelineDismissalHandler =
    (mode: "dismiss" | "undismiss"): RpcHandler =>
    (frame) => {
      const params = frame.params as { pipelineId?: unknown } | undefined;
      const pipelineId = typeof params?.pipelineId === "string" ? params.pipelineId : "";
      if (pipelineId.length === 0) {
        return { kind: "error", code: "invalid_params", message: "pipelineId required" };
      }
      const outcome =
        mode === "dismiss" ? store.dismissPipeline({ pipelineId }) : store.undismissPipeline({ pipelineId });
      if (outcome.kind === "refused") {
        return { kind: "response", result: outcome };
      }
      const pipeline = store.loadPipeline(pipelineId);
      return { kind: "response", result: { ...outcome, state: derivePipelineState(pipeline) } };
    };

  const handlePipelineListHandler: RpcHandler = (frame) => {
    const params = frame.params as { includeDismissed?: unknown } | undefined;
    const includeDismissed = params?.includeDismissed === true;
    const pipelines = store.listPipelines().filter((pipeline) => includeDismissed || pipeline.dismissedAt === null);
    return { kind: "response", result: { pipelines: pipelines.map(projectPipelineSnapshot) } };
  };
  ```

- `derivePipelineState` is already imported in `daemon.ts` from `./pipeline-execution.ts`; `store.loadPipeline` returns `Pipeline & { stages }`, which is what it needs.
- The mid-flight test can reuse `daemon-pipeline-observation.test.ts`'s `controllableBindingFactory` (a write step that resolves only when `settle()` is called) plus `waitFor` to hold a stage `running` across the dismiss call, then settle and assert the pipeline still reaches terminal state. That fixture is file-local (not exported) — copy it into the new test file rather than exporting it, which would touch a file outside this subspec's declared scope.
- The `mode === "dismiss" ? store.dismissPipeline(...) : store.undismissPipeline(...)` mode selector and the `state: derivePipelineState(pipeline)` attachment on `applied` results are already discriminated by the undismiss and mid-flight acceptance criteria above; no additional mutation directives are owed for either.
- The synthesized `Pipeline`-shaped value in `v2/src/tui/tui-monitor-lines.ts` (`snapshotHasReachableUndecidedGate`) feeds only boundary derivation and already sets `dismissedAt: null` — leave it alone.
