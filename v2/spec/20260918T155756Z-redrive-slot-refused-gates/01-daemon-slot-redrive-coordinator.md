# 01 — Daemon slot re-drive coordinator

## Problem

A `slot_contention` gate refusal settles the lane `failed`/`gate_invocation_refused` (`finishGateInvocationRefused`, `v2/src/execution/write-loop.ts`) and waits for an operator `jarvis run resume`, even though the daemon owns the lease set and (via 00) learns when a lease releases.

## Decisions

- In-process premise: `spawnWriteLoop` in `v2/src/daemon/daemon-run-lifecycle-handlers.ts` awaits `writeLoopExecutor(...)` inside the daemon process, so implement gate invocations acquire leases in the same module instance the daemon subscribes to via 00.
- Trigger: a lease release (00) wakes waiting slot-refused lanes; no timer or immediate retry, no holding the refused shell call open.
- Enqueue: when a run settles `failed`/`gate_invocation_refused` with durable `gateRefusalRecoveryState.cause` `slot_contention`, the daemon's run-settlement seam enqueues it; `ceiling_headroom` and `legacy_unknown` are never enqueued.
- Refusal-before-enqueue: at enqueue, if `gateInvocationAdmits(liveGateInvocationLeaseCount(), MAX_CONCURRENT_AGENT_GATE_INVOCATIONS)` already holds, drain immediately (deferred off the settling stack) instead of waiting for a release that already happened.
- Entry point: re-drive calls the same resume logic as the `run.resume` RPC handler (`resumeHandler`), which routes linked rows via `resumeLinkedWorkflowRow` and bare runs via `resumeReconstructedRun`; rules out a bespoke write-loop restart that skips linked/shrink/review/publication sequencing. It bypasses only the RPC frame, not admission.
- Drain: one release dispatches at most one lane, oldest first; rules out a thundering herd re-refusing each other. Ordering key is the run row's `finishedAt` (set at refusal settlement, durable), ties broken by run id; a lane that re-refuses re-queues behind others.
- Freed slot taken first: before dispatch the coordinator re-checks lease availability and, if the slot is gone, keeps the entry waiting without consuming a count; a slot lost after dispatch (re-refusal at the gate) consumes the count already incremented and re-enqueues.
- Operator actions while waiting: immediately before dispatch, reload the row; dispatch only if it is still `failed`/`gate_invocation_refused`, cause `slot_contention`, undismissed, and not already resumed; otherwise drop the entry, so a lane is never resumed twice.
- Owner and liveness safety: before incrementing, the pre-dispatch check reads the row's `owner_identity`; if a different owner is alive or the row is held by a reachable draining predecessor generation (the `run_owner_conflict` condition in `daemon-run-lifecycle-handlers.ts`), drop the entry without incrementing and log `slot_redrive_skipped_owner`; that owner re-drives or settles it. Rules out re-driving a row another live owner holds (today `run resume` refuses `owner_alive` right after a daemon self-handoff). An `owner_alive`/`claim_lost`/`run_owner_conflict` refusal that races past this check is logged as `slot_redrive_refused` and drops the entry.
- Count: `gateRefusalRecoveryState.slotRedriveCount` is lifetime per run and never reset by a gate pass; the write loop already preserves it on re-refusal (`finishGateInvocationRefused` reads it from the row). It is incremented durably on the run row before each dispatch; rules out counting after dispatch, which a crash would lose.
- Bound: one exported source constant caps re-drives per run, shared by fresh and restarted daemons; rules out config-driven or per-daemon-session bounds. A lane with count at or over the bound is not dispatched.
- Admission rejection of an automatic resume is logged (`slot_redrive_refused`, with the refusal code and count), consumes the already-incremented count, and drops the entry; the row stays `failed` and operator-resumable.
- Run-log events: each re-drive appends `slot_redrive` with `slotRedriveCount` and `bound`; bound exhaustion appends `slot_redrive_exhausted` once with `bound` and final `slotRedriveCount`, and the lane stays `failed`/`gate_invocation_refused` resumable.
- Do not raise the gate limit, throttle implement dispatch, or change lease ownership, acquisition, or release semantics.
- Deferred to first consumer: operator-visible CLI/list surfacing of pending re-drives — pin when a caller needs it.

## Task checklist

- [ ] Coordinator: enqueue from run settlement, immediate drain when a slot is already free, drain on release (00) oldest-first, one lane per release.
- [ ] Pre-dispatch row re-check, availability re-check, durable count increment, `slot_redrive` event, resume via the `resumeHandler` path.
- [ ] Admission-rejection logging and bound-exhaustion settlement with `slot_redrive_exhausted`.
- [ ] Tests and docs.

## Acceptance criteria

- [ ] A daemon write-path regression holds the gate lease, drives a second lane to `slot_contention` refusal, releases the holder, and proves the retained lane reaches its gate without an operator command; it fails against the pre-fix settle-and-stop behavior.
- [ ] A test releases the holder between the refusal settling and the enqueue and proves the lane is still re-driven; it fails against a release-only trigger.
- [ ] A test takes the freed slot with another lane before dispatch and proves the entry keeps waiting with its count unchanged, then re-drives on the next release.
- [ ] A test pauses, kills, dismisses, or manually resumes a waiting lane and proves the coordinator drops it and never resumes it a second time.
- [ ] A test covers a linked row and a bare run each re-driving through the resume path, and an admission rejection that is logged as `slot_redrive_refused`, counted, and leaves the row resumable.
- [ ] A test stamps a waiting lane's `owner_identity` to a different live process (and, separately, to a reachable draining predecessor generation), releases the lease, and proves the coordinator neither calls the resume path nor increments `slotRedriveCount`, logging `slot_redrive_skipped_owner`; it fails against a coordinator that dispatches without the owner check.
- [ ] A test proves each successful re-drive increments the persisted `slotRedriveCount` by exactly one and that a lane at the exported bound is not dispatched.
- [ ] A test proves two waiting lanes with one release re-drive only the oldest by `finishedAt`.
- [ ] A test proves a `ceiling_headroom` refusal is never auto-re-driven after a lease release and keeps its `failed`/`gate_invocation_refused` resumable settlement.
- [ ] A test exhausts the bound and proves the lane settles with a `slot_redrive_exhausted` event carrying the bound and final count, every attempted re-drive has a `slot_redrive` event, and the count persists across a gate pass.
- [ ] Existing one-slot lease ownership tests in `v2/src/execution/write-loop.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — release-triggered slot re-drive, oldest-first one lane per release, lifetime durable bound, run-log events, unchanged headroom refusal.
- `v2/docs/operator-runbook.md` — § Concurrency: recovery after automatic slot re-drive; manual resume remains for headroom refusals, bound exhaustion, and rejected re-drives.
- `v2/docs/v1-behaviors.md` — bounded daemon slot re-drive is v2-only.
