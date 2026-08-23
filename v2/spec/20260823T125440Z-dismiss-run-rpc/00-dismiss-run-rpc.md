# Daemon dismiss/undismiss run requests and default-excluding list

## Problem

`listHandler` (`v2/src/daemon/daemon.ts:1521`) projects `store.listRuns()` unconditionally — the only thinning is `retainListedRuns`, the 50-newest-terminal window. The durable run dismissal flag exists (`runs.dismissed_at`, migration `028-run-dismissed-at`, `dismissRun`/`undismissRun` on `StateStore`) but nothing on the wire reaches it: no request records an operator's dismissal, `buildRunListRow` drops `dismissedAt`, and every client (`jarvis run list`, `--json`, the TUI work tree) repaints dead terminal runs until they age past the window. Three existing safety/routing reads sweep the same `list` projection and must not silently start missing dismissed runs once the filter lands: `resolveRunOwnerSocket` (`v2/src/commands/run.ts`, feeds `run log`/`run tail`), and `createBulkCleanupDaemonClient`/`createStaleResetDaemonClient` (`v2/src/commands/cleanup.ts`, feed `checkEligibility` and `isWorktreeLiveHeld`).

## Decision ledger

- `includeDismissed?: boolean` joins both `ListRpcParams` and `LIST_RPC_PARAM_KEYS` (`v2/src/commands/run-list-rpc.ts`) so `resolveListRpcRequest` serializes it end to end for any client that sets it — rules out keeping it out of `LIST_RPC_PARAM_KEYS`, which would silently drop the parameter before the frame is ever built and leave the sibling `dismiss-run-cli` flag unable to transmit it. Retention bypass is governed independently: `listRpcRequestIsFiltered` reads its own explicit five-field list (`sinceMs`/`project`/`branch`/`specPath`/`status`) and is left unchanged, so `includeDismissed` joining `LIST_RPC_PARAM_KEYS` does not put it on the filtered (retention-bypassing) path — the two constants are separate switches, not one.
- The dismissal filter applies to the filtered (`sinceMs`/dimension) path as well as the unfiltered one, with `includeDismissed` the single opt-in for both — rules out excluding only on the default path, which would let `--since` resurrect rows the operator just hid.
- The `includeDismissed === true` read is off the raw `frame.params`, typed loosely, not off the `ListRpcParams`-typed `listParams` — a real client can only ever send a boolean (the type forbids anything else), so the strict-equality check exists to fail safe against a value no typed caller can produce; there is no contradiction between "the type governs client serialization" and "the handler reads defensively," they describe the client side and the handler side of the same field.
- `dismissedAt` rides every projected run row unconditionally (`number | null`, `null` when not dismissed) — the daemon always emits it on the wire regardless of `includeDismissed`. Separately, `DaemonListRunRow.dismissedAt` is declared *optional* (`?: number | null`) on the TS type only to avoid forcing `dismissedAt: null` into ~30 unrelated run-row fixtures across `v2/src/tui`, `v2/src/commands`, and `v2/src/daemon`; wire presence and type optionality are independent facts about different layers, not a self-contradiction.
- Workflow sibling visibility for indexing is independent of the dismissal filter. `indexListedRuns` (`v2/src/daemon/daemon.ts:1393-1416`) builds the invocation→step index from the same set the rows are projected from; `runListRowWorkflowField` and `workflowEntryRollupStatus` read that index, while `reportedRunStatus` rolls up separately over the already-unfiltered `store.findRunsByInvocationId`. Narrowing `indexListedRuns`'s input to the dismissal-filtered set would make a surviving entry row's `workflow` field and status rollup change purely because a sibling step run was dismissed, contradicting "otherwise identical to the default projection." Decision: when a selected run carries a workflow snapshot, `listHandler` also loads its full sibling set via `store.findRunsByInvocationId` and folds those siblings into `indexListedRuns`'s input alongside the dismissal-filtered, retention-narrowed rows — a dismissed sibling is indexed (so rollups see it) without itself being listed. Rules out feeding `indexListedRuns` the dismissal-filtered set outright.
- The requests are `dismiss` / `undismiss` in the unprefixed run-request family alongside `kill`/`pause`/`list` — rules out a `run_`-prefixed name, which would make operators learn two rules for one concept. Parity with `pipeline_dismiss`/`pipeline_undismiss` is in the params shape (`{ runId }` mirroring `{ pipelineId }`), the outcome-in-result envelope, and the strict opt-in read — not field-for-field: `pipeline_dismiss`'s `applied` carries `state` (a pipeline has a derived state to report); the run version carries `status` instead, because a run's terminal/live status is the equivalent signal.
- Both handlers return the store's `RunDismissalOutcome` as the RPC `result` (`refused` with `reason: "run_not_found"` included) — rules out the run family's own `unknown_run` **error frame** (`pause`, `kill`, `wait`), which turns a mistyped id into an RPC error the CLI must catch rather than a value it can print; the `pipeline_dismiss` outcome-in-result contract wins here because the CLI intent mirrors pipeline refusal handling.
- `applied` additionally carries the durable run row's `status` so a caller dismissing live work can warn — rules out the workflow rollup status `list` reports for entry rows, which needs the sibling-run index `list` builds and would make a display flag pay for a rollup.
- Missing or empty `runId` → `invalid_params` before the store is touched — rules out letting the store answer `run_not_found` for a request that never named a run, which reports a mistyped id and an omitted id identically.
- Idempotence is inherited from the store, not re-derived at the RPC layer: a repeat `dismiss` returns `applied` with the original `dismissed_at` unchanged (first-writer-wins), and `undismiss` on a never-dismissed run returns `applied` with no store write.
- Dismissal admits no execution: no `activeRuns` lookup, no abort, no status write, and no `retiring` → `daemon_superseded` guard — rules out reusing the `kill` path, and rules out treating a display flag as new work a retiring daemon must refuse.
- `resolveRunOwnerSocket` (`v2/src/commands/run.ts`) locates a run's owning daemon by sweeping `list`; it must keep resolving dismissed runs so `run log`/`run tail` keep routing correctly, so its `list` call passes `includeDismissed: true` — rules out leaving it on the new default, which would silently misroute those commands in a multi-daemon setup as soon as a run is dismissed.
- Cleanup's daemon-list reads are safety checks, not display, and must not honor the dismissal filter: `createBulkCleanupDaemonClient` and `createStaleResetDaemonClient` (`v2/src/commands/cleanup.ts`) pass `includeDismissed: true` on every `list` call they issue, so `checkEligibility`'s daemon liveness check and `isWorktreeLiveHeld` (gating retire/abandon) keep treating a dismissed-but-live run as live — rules out an unqualified "every existing caller adopts the exclusion as-is": that is true only for display callers (`jarvis run list`, `--json`, the TUI) and would be false, and unsafe, for these two.
- Nothing here clears `dismissed_at`: `resume`, reconciliation, and restart recovery all keep driving a dismissed run, which stays out of every default listing until undismissed. This is the daemon-surface consequence of the landed store decision, not a new one.

## Task checklist

- Add `includeDismissed?: boolean` to `ListRpcParams` and `LIST_RPC_PARAM_KEYS` (`v2/src/commands/run-list-rpc.ts`); leave `listRpcRequestIsFiltered` untouched.
- Add `dismissedAt?: number | null` to `DaemonListRunRow` (`v2/src/daemon/daemon-wire.ts`) and emit `dismissedAt: run.dismissedAt ?? null` unconditionally from `buildRunListRow`.
- Add a `handleRunDismissalHandler("dismiss" | "undismiss")` factory in `v2/src/daemon/daemon.ts` and register `dismiss` / `undismiss` in `handlersOut`.
- Give `listHandler` its `includeDismissed` opt-in, the pre-retention dismissed filter on the projected row set, and the sibling-fold-in for `indexListedRuns` described in the decision ledger.
- Pass `includeDismissed: true` on every `list` call made by `resolveRunOwnerSocket` (`v2/src/commands/run.ts`), `createBulkCleanupDaemonClient`, and `createStaleResetDaemonClient` (`v2/src/commands/cleanup.ts`).
- Extend the existing `resolveListRpcRequest`/`listRpcRequestIsFiltered` test (`v2/src/commands/run-list-query-limit-cap.test.ts`) to cover `includeDismissed`.
- Add `v2/src/daemon/daemon-run-dismiss.test.ts` with the tests below and their in-body `// @mutate` directives on the real handler guards.
- Update `v2/src/commands/run.test.ts` and `v2/src/commands/cleanup.test.ts` coverage per the acceptance criteria below.
- Update `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A daemon test dismisses a terminal run and asserts: the dismiss response is exactly `{ kind: "applied", runId, status: <the run's terminal status> }`; the next default `list` (no params) omits it while a sibling non-dismissed terminal run is still listed; it fails against the pre-fix daemon, which has no `dismiss` handler and lists every retained run.
- [ ] A daemon test asserts `list { includeDismissed: true }` returns the dismissed run with numeric `dismissedAt`, returns the non-dismissed sibling with `dismissedAt: null`, and is otherwise identical to the default projection.
- [ ] A daemon test asserts `list { includeDismissed: "true" }` (a truthy non-boolean, sent by bypassing the `ListRpcParams` type) still omits the dismissed run, proving the opt-in reads strict `=== true`.
- [ ] A daemon test asserts `undismiss` returns `{ kind: "applied", runId, status }` and restores the run to the default listing with `dismissedAt: null`.
- [ ] A daemon test asserts `undismiss` on a run that was never dismissed also returns `{ kind: "applied", runId, status }`, and leaves `dismissed_at` null.
- [ ] A daemon test dismisses an already-dismissed run a second time and asserts the repeat call also returns `{ kind: "applied", ... }` while `list { includeDismissed: true }` still reports the original `dismissedAt`, unchanged by the repeat.
- [ ] A daemon test seeds 51 terminal runs, dismisses one of the 50 newest, and asserts the default `list` returns 50 rows including the run that was previously outside the retention window — a dismissed run does not consume a terminal-retention slot.
- [ ] A daemon test asserts `list { includeDismissed: true }` over 55 terminal runs still returns only the 50 newest, proving the opt-in does not put the request on the filtered (retention-bypassing) path.
- [ ] A daemon test asserts a dismissed run is still returned by a filtered `list` (`{ specPath }` matching it) when `includeDismissed: true` is passed, and omitted from the same filtered call without it.
- [ ] A daemon test asserts an unknown run id is refused on both requests with `{ kind: "refused", runId, reason: "run_not_found" }` as the RPC `result` (not an error frame), and that a real run in the same store still lists.
- [ ] A daemon test asserts an omitted `runId` is refused `invalid_params` on both requests.
- [ ] A daemon test starts a two-step workflow, lets the first step reach terminal, dismisses that step run, and asserts the still-listed entry row's `workflow` field and rollup status are byte-identical to their values before the dismissal — a dismissed sibling step run does not change a surviving entry row's projection.
- [ ] A test extending `v2/src/commands/run-list-query-limit-cap.test.ts` asserts `resolveListRpcRequest({ includeDismissed: true, ... })` returns `includeDismissed: true` in the resolved params, and `listRpcRequestIsFiltered({ includeDismissed: true })` returns `false`.
- [ ] A test extending the `resolveRunOwnerSocket` coverage in `v2/src/commands/run.test.ts` dismisses a run owned by a non-invoking daemon and asserts `run log`/`run tail` still route to and stream from that daemon.
- [ ] A test extending the `createBulkCleanupDaemonClient` coverage in `v2/src/commands/cleanup.test.ts` dismisses a live run and asserts `checkEligibility` (or the retire/abandon live-held gate) still reports it live, proving cleanup's daemon-list reads are unaffected by dismissal.
- [ ] A daemon test dismisses a run whose write loop is held mid-flight and asserts: the dismiss response is `{ kind: "applied", runId, status: "in-progress" }`; the durable row's `status`, `attempt_count`, and `worktree_path` are unchanged by the call; the default `list` omits it while the run is still live; the row is still `isLive: true` under `list { includeDismissed: true }`; and after the held loop is released the run still reaches `completed` with `dismissedAt` still set.
- [ ] `v2/src/daemon/daemon-run-dismiss.test.ts` — `dismissed runs drop out of the default list`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the `list` handler's `includeDismissed || (run.dismissedAt ?? null) === null` filter predicate to `true` (baseline: `list` projects every retained run unconditionally) turns this test red, while the unknown-id and `invalid_params` tests stay green.
- [ ] `v2/src/daemon/daemon-run-dismiss.test.ts` — `includeDismissed returns dismissed runs with dismissedAt set`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the run `list` handler's opt-in read to `false` makes the opt-in call behave like the default call, turning this test red — proving the parameter widens the projection rather than the rows being listed anyway.
- [ ] `v2/src/daemon/daemon-run-dismiss.test.ts` — `a dismissed run does not consume a terminal retention slot`; Mutation checkpoint: an in-body `// @mutate` directive reordering the dismissal filter behind `retainListedRuns` so the dismissed run eats a slot and the previously-evicted run stays missing — turning this test red while `dismissed runs drop out of the default list` stays green.
- [ ] `v2/src/daemon/daemon-run-dismiss.test.ts` — `includeDismissed alone does not bypass terminal retention`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the `list` handler's `listRpcRequestIsFiltered(listParams)` call to `listRpcRequestIsFiltered(listParams) || includeDismissed` classifies the opt-in as a filter and skips retention, returning all 55 terminal runs — turning this test red.
- [ ] `v2/src/daemon/daemon-run-dismiss.test.ts` — `a dismissed sibling step run does not change a surviving entry row's projection`; Mutation checkpoint: an in-body `// @mutate` directive narrowing `indexListedRuns`'s input to the dismissal-filtered row set (dropping the sibling fold-in) changes the surviving entry row's `workflow` field once the sibling is dismissed — turning this test red.
- [ ] `v2/src/daemon/daemon-run-dismiss.test.ts` — `an unknown run id is refused on dismiss and undismiss`; Mutation checkpoint: an in-body `// @mutate` directive neutering the dismissal handler's refusal return guard to `if (false) {` makes both requests proceed to `store.loadRun` on the unknown id and read `status` off `null`, throwing rather than returning the named `run_not_found` refusal — turning this test red.
- [ ] `v2/src/daemon/daemon-run-dismiss.test.ts` — `a missing runId is refused invalid_params on dismiss and undismiss`; Mutation checkpoint: an in-body `// @mutate` directive neutering the `runId` validation to `if (false) {` makes both requests reach the store and answer `run_not_found` for a request that named no run — turning this test red.
- [ ] `v2/src/daemon/daemon-start-list.test.ts`, `v2/src/daemon/daemon-terminal-run-retention.test.ts`, `v2/src/daemon/daemon-workflow-start.test.ts`, and `v2/src/commands/run-list-since-queries-history.test.ts` stay green unmodified (no run is dismissed in them, so the default projection is unchanged for every existing case).
- [ ] `v2/docs/daemon-host.md` — the request table gains `dismiss` and `undismiss` rows: params, `applied`-with-`status` / `refused` result shapes, `invalid_params`, inherited store idempotence in both directions, no `daemon_superseded` guard, and that dismissal never aborts, transitions, or changes ownership.
- [ ] `v2/docs/daemon-host.md` — the `list` row records the optional `includeDismissed` parameter, the strict `=== true` opt-in, and that the default exclusion applies to both the retained and the filtered (`sinceMs`/dimension) path.
- [ ] `v2/docs/daemon-host.md` — the `list` row records that the dismissal filter runs ahead of the 50-newest-terminal window (a dismissed run consumes no retention slot) and that `includeDismissed` is not a filter field and does not itself bypass retention.
- [ ] `v2/docs/daemon-host.md` — records that `dismissedAt` rides every row, that durable state and by-id reads (`wait`/`kill`/`pause`/`tail`, reconciliation sweeps) still see dismissed runs, and names `resolveRunOwnerSocket` and cleanup's daemon-list reads as callers that opt in to `includeDismissed` for correctness rather than adopting the display default.
- [ ] `v2/docs/v1-behaviors.md` — a `[v2 behavior change]` entry records that daemon `list` no longer returns every retained run by default: runs with a non-null `dismissedAt` (set via the new `dismiss` RPC) are excluded unless the request passes `includeDismissed: true` (strict, not any truthy value), and the exclusion applies ahead of terminal retention and on the filtered `sinceMs`/dimension path alike.
- [ ] `v2/docs/v1-behaviors.md` — the same entry names which existing callers change behavior (`jarvis run list`, `--json`, `jarvis cleanup` merged-worktree display) versus which opt in and keep seeing dismissed runs (`resolveRunOwnerSocket`'s by-id routing, cleanup's live-held safety checks).
- [ ] `v2/docs/v1-behaviors.md` — a `[v2 additive]` entry records that every `list` row now carries `dismissedAt` and that `dismiss`/`undismiss` exist as run requests alongside `kill`/`pause`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `dismiss` / `undismiss` request-table rows; `list` row updated for `includeDismissed`, default exclusion on both paths, filter-before-retention ordering, `dismissedAt` on every row, and which by-id/safety callers opt in versus adopt the display default.
- `v2/docs/v1-behaviors.md` — `list` no longer returns every retained run by default, which callers change behavior versus opt in, `dismissedAt` on every row, and the two new run requests, as separate entries per the split acceptance criteria above.

## Implementer notes

- Suggested shape, keeping each guard independently quotable by one single-line `@mutate` directive. The anchors below must each occur exactly once in `daemon.ts`, which the pipeline handlers already constrain: `params?.includeDismissed === true`, `if (outcome.kind === "refused") {`, and `runId.length === 0` are already taken by `handlePipelineDismissalHandler` / `handlePipelineListHandler`, so the run versions must read the frame inline and name the outcome `dismissal`.

  ```ts
  const handleRunDismissalHandler =
    (mode: "dismiss" | "undismiss"): RpcHandler =>
    (frame) => {
      const params = frame.params as { runId?: unknown } | undefined;
      const runId = typeof params?.runId === "string" ? params.runId : "";
      if (runId.length === 0) {
        return { kind: "error", code: "invalid_params", message: "runId required" };
      }
      const dismissal = mode === "dismiss" ? store.dismissRun(runId) : store.undismissRun(runId);
      if (dismissal.kind === "refused") {
        return { kind: "response", result: dismissal };
      }
      const run = store.loadRun(runId)!;
      return { kind: "response", result: { ...dismissal, status: run.status } };
    };
  ```

  ```ts
  const listHandler: RpcHandler = (frame) => {
    const listParams = frame.params as ListRpcParams | undefined;
    const includeDismissed = listParams?.includeDismissed === true;
    let durableRuns = store.listRuns();
    if (listRpcRequestIsFiltered(listParams)) {
      durableRuns = durableRuns
        .filter((run) => runMatchesListRpcParams(run, listParams))
        .slice(0, listParams?.limit ?? FILTERED_LIST_DEFAULT_LIMIT);
    } else {
      durableRuns = retainListedRuns(durableRuns);
    }
    const projectedRuns = durableRuns.filter((run) => includeDismissed || (run.dismissedAt ?? null) === null);
    // Fold in dismissed siblings so the workflow index sees a complete invocation even when one
    // step run was filtered out above; siblings are indexed, not themselves listed.
    const indexInputRuns = new Map(projectedRuns.map((run) => [run.id, run]));
    for (const run of projectedRuns) {
      const fullRun = store.loadRun(run.id);
      const invocationId = fullRun?.workflowSnapshot?.invocationId;
      if (invocationId === undefined) continue;
      for (const sibling of store.findRunsByInvocationId(invocationId)) {
        if (!indexInputRuns.has(sibling.id)) indexInputRuns.set(sibling.id, sibling);
      }
    }
    const { fullRuns, workflowRuns } = indexListedRuns([...indexInputRuns.values()]);
    // runList maps over projectedRuns (not indexInputRuns) — folded-in siblings are indexed only.
    // unchanged from here
  ```

- `Run.dismissedAt` is declared `?: number | null` on the store type but `RUN_COLUMNS` always selects `dismissed_at AS dismissedAt` and `mapRunRow` spreads the row, so live rows are `number | null`; the `?? null` normalizations above cover the type, not a real absent case.
- `listRunsDirect(handlers, params)` (`v2/src/testing/run-control.ts`) types `params` as `ListRpcParams`, so the new field makes it usable for the opt-in tests unchanged; the strict-`=== true` test needs a raw `handlers.list` frame instead, since `ListRpcParams` forbids a non-boolean.
- Seed terminal runs with `daemon-terminal-run-retention.test.ts`'s local `seedRun` helper (it back-dates `created_at` through a second `Database` handle); copy it into the new file rather than exporting it, which would touch a file outside this subspec's scope.
- Hold a run mid-flight with a `writeLoopExecutor` that awaits a test-controlled promise, as `daemon-start-list.test.ts` does; the run stays `in-progress` and `isLive` across the dismiss call, and releasing the promise settles it normally.
- The `mode === "dismiss" ? store.dismissRun(runId) : store.undismissRun(runId)` selector and the `status` attachment on `applied` results are already discriminated by the undismiss and live-run acceptance criteria; no additional mutation directives are owed for either.
- `resolveRunOwnerSocket`'s and cleanup's `list` calls change by adding `{ includeDismissed: true }` (or merging it into whatever params object they already build) — no other logic in `run.ts`/`cleanup.ts` changes.
