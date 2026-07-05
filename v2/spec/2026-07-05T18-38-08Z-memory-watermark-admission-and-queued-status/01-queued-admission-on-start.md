# 01 - Queued admission on start

`start` currently rejects a second request outright with `run_in_progress`
whenever any run is active globally (`v2/src/daemon/daemon.ts`, single
in-flight guard documented in `v2/docs/daemon-host.md#admission-guards-for-start`).
This slice replaces that hard reject with the memory-watermark check from
[00](./00-memory-watermark-config.md): a `start` that clears the watermark
admits and spawns as today; a `start` that doesn't clear it is durably
persisted `queued` instead of erroring.

## Decisions

- The memory-watermark check replaces the count-based single-in-flight guard
  entirely — a `start` is no longer rejected just because another run is
  live. This is what makes `queued` reachable in practice: keeping the hard
  count-of-one cap would make every second `start` fail before the watermark
  is ever measured, and the intent's "queued runs are admitted in order"
  requires that more than one run can be in flight when memory allows.
- The per-`(project, branch)` ownership guard (`worktree_claimed`) is
  unchanged — a queued or in-flight run still exclusively claims its key.
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

## Task checklist

- [ ] Add `"queued"` to `RUN_STATUSES`.
- [ ] Add a durable column (schema migration, following the existing
      `SCHEMA_MIGRATIONS` pattern in `state-store.ts`) to store the queued
      run's serialized `WriteLoopInput`, and a `StateStore` accessor to read
      it back for promotion.
- [ ] In the `start` handler: after the per-`(project, branch)` claim check,
      call `hasMemoryHeadroom`; when it returns `false`, `createRun` with
      status `"queued"` plus the persisted input and return `{ runId }`
      without spawning; when `true`, proceed as today.
- [ ] Update `v2/docs/daemon-host.md`'s admission-guards section: drop the
      single in-flight guard, document the memory-watermark check and the
      `queued` status outcome.

## Acceptance criteria

- [ ] A `start` call when the injected free-memory reader reports headroom
      below the configured `minFreeGb` returns `{ runId }` (not an error), and
      the run's durable status is `queued`.
- [ ] A `start` call for a second `(project, branch)` while another run is
      live and memory clears the watermark spawns and admits normally (no
      more `run_in_progress` rejection based on live-run count alone).
- [ ] A `start` call for a `(project, branch)` key already claimed (live or
      queued) is still rejected `worktree_claimed`, unchanged from today.
- [ ] `list` reports a queued run with `status: "queued"`, `isLive: false`.
- [ ] `v2/docs/daemon-host.md` no longer documents a count-based single
      in-flight admission guard.

## Documentation updates

- `v2/docs/daemon-host.md`: rewrite `### Admission guards for start` to
  describe the memory-watermark check and `queued` status in place of the
  single in-flight guard; update the `start` row in the RPC methods table.
