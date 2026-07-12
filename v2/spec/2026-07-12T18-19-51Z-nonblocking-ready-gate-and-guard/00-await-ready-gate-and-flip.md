# 00 - Await the ready gate and draft-to-ready flip

`v2/src/execution/ready-finalize.ts` shells out with `execFileSync`: `bun run ready` in the worktree, then `gh pr ready <branch>` with up to three attempts. Both block the daemon's event loop for the whole gate (minutes), so `list` and `tail` stall while a run finalizes. Convert both seams to awaited async subprocess calls.

## Decisions

- Run both commands through `AsyncSubprocessRunner` (`shared/subprocess.ts`); rules out a bespoke `execFile` wrapper in this module, and rules out `Bun.spawn`.
- Keep `ReadyGate` / `GhReadyFlip` seam types, widened to return `Promise<void>`; rules out inventing a new seam shape that would churn every `readyFinalizer` test double.
- The finalizer still awaits the gate to green before the first flip attempt, and awaits each retry; rules out backgrounding either step.
- Preserve exit-status and stderr detail in the `ready gate failed (exit N): …` message and preserve the `already ready` / `not a draft` success guard and flat 1s backoff over three attempts; rules out simplifying error text or retry policy while changing the call shape.

## Acceptance criteria

- [ ] Neither the ready gate nor the draft-to-ready flip blocks the event loop: `v2/src/execution/ready-finalize.ts` imports no synchronous `node:child_process` API and awaits both subprocesses.
- [ ] The gate is awaited to success before the first flip attempt, and each of the up-to-three flip attempts is awaited.
- [ ] `v2/src/execution/ready-finalize.test.ts` stays green (behavior unchanged by the conversion): retry count, flat backoff, retry notice, `already ready` / `not a draft` success guard, terminal failure propagation, and the `ready gate failed (exit N)` message with captured stderr.
- [ ] A rejected async gate seam surfaces as a ready-gate failure and no flip is attempted; a rejected async flip seam surfaces through `readyFinalizeError` in `v2/src/execution/write-loop.test.ts`.

## Documentation updates

- `v2/docs/write-behavior.md`: ready gate and draft-to-ready flip are asynchronous and awaited; ordering, retries, and failure text.
- `v2/docs/v1-behaviors.md`: record the v2 finalization behavior.
