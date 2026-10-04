# Sampling interval backoff retry through retiring

## Problem

`startStableDigestTrigger` already opens a backoff window and retries on later samples when `onTick` runs (`stable-digest-trigger.test.ts` covers that in isolation). Production wires the trigger through `scheduleSampling` in `daemon.ts`, which runs sole-owner self-heal then returns without calling `onTick` while `isRetiring()` is still true — reachable on main after a failed self-handoff when admission stays cut until self-heal applies or rollback has already reopened it but the generation flag has not cleared yet. The interval keeps firing, but digest sampling and backoff retry never advance.

## Decisions

- After the self-heal gate on each self-handoff sampling tick, always invoke the stable-digest `onTick` callback — rules out keeping the post-self-heal `if (isRetiring()) return` from retiring-sole self-heal wiring that dropped every tick while `isRetiring()` remained true.
- Self-heal still runs before digest sampling on the same tick, unchanged — rules out moving self-heal after `onTick` or duplicating reopen logic inside `startStableDigestTrigger`.
- Backoff, two-sample stability, and single-flight stay inside `startStableDigestTrigger` — rules out reimplementing retry timing in `daemon.ts`.
- Only runtime teardown (`close()` / trigger `stop()`) stops the sampling interval — rules out clearing the interval on a failed or rolled-back self-handoff.
- Export or otherwise reuse the production self-handoff sampling interval body (self-heal gate then `onTick`) for the regression's `scheduleSampling` wrapper — rules out a trigger-only test that never exercises the retiring skip that blocked retry on main.

## Task checklist

- [ ] Remove the post-self-heal retiring-only early return in `startDaemonRuntime`'s self-handoff `scheduleSampling` callback; update the adjacent inline comment to match.
- [ ] Add a `startStableDigestTrigger` regression in `stable-digest-trigger.test.ts` with a fake clock and manual scheduler whose `scheduleSampling` mirrors production tick order (self-heal stub, then the interval body under test): after `rolled_back`, advance time past `selfHandoffBackoffMs(1)`, fire sampling ticks until the trigger would retry on a direct `onTick` path, and assert `startHandoff` is invoked again — fails against the pre-fix production interval body reachable on main (`if (isRetiring()) return` before `onTick`).
- [ ] Align `v2/docs/daemon-host.md` § Autonomous self-handoff and the `[v2-only]` autonomous self-handoff bullet in `v2/docs/v1-behaviors.md` per Documentation updates below.

## Acceptance criteria

- [x] A `startStableDigestTrigger` regression in `stable-digest-trigger.test.ts` with a fake clock and scheduler asserts that after a failed handoff (`rolled_back`) and rollback, the next sampling tick past the backoff window calls `startHandoff` again; it fails against the pre-fix code reachable on main where the self-handoff sampling interval returned before `onTick` while `isRetiring()`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- [x] `v2/docs/daemon-host.md` § Autonomous self-handoff — after rollback restores admission or sole-owner self-heal reopens it, later sampling ticks still run digest sampling so exponential backoff retry can invoke another self-handoff attempt; self-heal-before-sampling order unchanged.
- [x] `v2/docs/v1-behaviors.md` — `[v2-only]` autonomous self-handoff bullet: replace the post-self-heal retiring cutoff that skipped digest sampling with continued sampling through stranded retiring so backoff retry can fire (self-heal gate unchanged).
