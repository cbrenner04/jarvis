# 01 - Queued admission on start

`start`, `resume`, and `revise` (`reviseAwaitingHuman`) each currently reject
with `run_in_progress` whenever any run is active globally (`activeRuns.size >
0` in `v2/src/daemon/daemon.ts`, single in-flight guard documented in
`v2/docs/daemon-host.md#admission-guards-for-start`). This slice replaces that
hard reject with the memory-watermark check from
[00](./00-memory-watermark-config.md), scoped to `start` only for the
queuing behavior: a `start` that clears the watermark admits and spawns as
today; a `start` that doesn't clear it is durably persisted `queued` instead
of erroring.

## Decisions

- The count-based `activeRuns.size > 0` guard is removed from all three call
  sites (`start`, `resumeHandler`, `reviseAwaitingHuman`), not just `start` —
  leaving it on the other two would still reject a second run whenever any
  run is live, contradicting the "more than one run can be in flight" premise
  the whole feature depends on. Each call site's own `(project, branch)`
  ownership check (`worktree_claimed`) already protects it, so removing the
  count guard is safe everywhere it appears.
- Only `start` gains queuing behavior. `resume` and `revise` simply stop
  rejecting on global run count; they continue to spawn immediately once
  their own `worktree_claimed` check passes — no memory-watermark check, no
  `queued` outcome for either.
- `worktree_claimed` on `start` is a query-based conflict check, not an
  in-memory registry claim: a queued run has no `spawnWriteLoop` invocation
  and so never reaches `_registry.claim`. `start`'s claim check becomes
  "`_registry.isClaimed(key)` (live) OR a durable non-terminal `queued` row
  exists for `key`" — rules out claiming the in-memory registry at queue time
  and releasing it at promotion, which would require a second release path
  alongside `spawnWriteLoop`'s existing claim/release and risks a double-claim
  when promotion calls `spawnWriteLoop`.
- `start` never blocks waiting on the watermark: it checks once, synchronously,
  and returns immediately either way (`{ runId }` in both the admitted and
  queued cases) — rules out a `start` that hangs until memory frees, which
  would break the existing "spawn in background, return immediately" contract
  every other caller (TUI, resume) depends on.
- A queued run's full `WriteLoopInput` (the `start` RPC's `params.input`,
  already normalized JSON since it crosses the IPC boundary) is persisted
  durably so a later promotion (spec [02](./02-fifo-promotion.md)) can spawn
  it without the original caller's process still being alive — rules out
  keeping it in an in-memory queue only, which would silently drop queued
  runs across a daemon restart.
- New `RunStatus` value `"queued"` added to `RUN_STATUSES`
  (`v2/src/persistence/state-store-types.ts`). A queued run is not terminal
  and is not live (`isLive: false` on `list`).
- `StateStore.createRun` accepts an optional `status` (default `"in-progress"`,
  matching today's hardcoded literal) instead of hardcoding `'in-progress'` in
  the insert — rules out a parallel `createQueuedRun` method, since the two
  paths otherwise duplicate every other column.

## Task checklist

- [ ] Add `"queued"` to `RUN_STATUSES`.
- [ ] Add a durable column (schema migration, following the existing
      `SCHEMA_MIGRATIONS` pattern in `state-store.ts`) to store the queued
      run's serialized `WriteLoopInput`, and a `StateStore` accessor to read
      it back for promotion.
- [ ] Change `StateStore.createRun`'s insert to accept and use an optional
      `status` argument (default `"in-progress"`) instead of the hardcoded
      `'in-progress'` literal in the SQL.
- [ ] Add a `StateStore` query for "does a non-terminal `queued` row exist for
      `(project, branch)`" and use it alongside `_registry.isClaimed(key)` in
      `start`'s `worktree_claimed` check.
- [ ] In the `start` handler: after the extended `worktree_claimed` check,
      call `hasMemoryHeadroom`; when it returns `false`, `createRun` with
      status `"queued"` plus the persisted input and return `{ runId }`
      without spawning; when `true`, proceed as today.
- [ ] Remove the `activeRuns.size > 0` / `run_in_progress` check from
      `resumeHandler` and `reviseAwaitingHuman`.
- [ ] Update `v2/docs/daemon-host.md`'s admission-guards section: drop the
      single in-flight guard everywhere it's documented, document the
      memory-watermark check and the `queued` status outcome for `start`.

## Acceptance criteria

- [x] A `start` call when the injected free-memory reader reports headroom
      below the configured `minFreeGb` returns `{ runId }` (not an error), and
      the run's durable status is `queued`.
- [x] A `start` call for a second `(project, branch)` while another run is
      live and memory clears the watermark spawns and admits normally (no
      more `run_in_progress` rejection based on live-run count alone).
- [x] A `resume` or `revise` call for a second `(project, branch)` while
      another run is live succeeds (spawns) instead of rejecting
      `run_in_progress`, provided its own `worktree_claimed` check passes.
- [x] A `start` call for a `(project, branch)` key already claimed — whether
      by a live run or an existing queued run for that key — is rejected
      `worktree_claimed`.
- [x] `list` reports a queued run with `status: "queued"`, `isLive: false`.
- [x] `v2/docs/daemon-host.md` no longer documents a count-based single
      in-flight admission guard on any of `start`, `resume`, or `revise`.

## Documentation updates

- `v2/docs/daemon-host.md`: rewrite `### Admission guards for start` to
  describe the memory-watermark check and `queued` status in place of the
  single in-flight guard; update the `start`, `resume`, and `revise` rows in
  the RPC methods table to drop the count-based rejection.
- `v2/docs/v1-behaviors.md`: record the removal of the global single
  in-flight guard on `start`/`resume`/`revise` (behavior change to existing
  functionality).
