# 00 - Await the ready gate and draft-to-ready flip

`v2/src/execution/ready-finalize.ts` shells out with `execFileSync`: `bun run ready` in the worktree, then `gh pr ready <branch>` with up to three attempts. Both block the daemon's event loop for the whole gate (minutes), so `list` and `tail` stall while a run finalizes. Convert both seams to awaited async subprocess calls.

## Decisions

- Run both commands through `AsyncSubprocessRunner` (`shared/subprocess.ts`); rules out a bespoke `execFile` wrapper in this module, and rules out `Bun.spawn`.
- Extend `realAsyncSubprocessRunner`'s rejection to carry the exit status and the captured `stdout`/`stderr`; today it discards the stderr callback argument and rejects with a raw Node `execFile` error whose exit field is `code`, not `status`. Without this the finalizer's `ready gate failed (exit N): <stderr>` message and the `already ready` / `not a draft` guard (which reads `stdout`/`stderr`) cannot survive the conversion — rules out relying on Node folding stderr into `error.message`, which is incidental and untested, and rules out dropping the guard.
- Pass an explicit `maxBuffer` large enough for `bun run ready`'s full output (its output is large; Node's default truncates and turns a green gate into a spurious failure); rules out taking the `execFile` default.
- Keep `ReadyGate` / `GhReadyFlip` seam names and parameters; only their return types widen to `Promise<void>`. Existing test doubles become async — assertions unchanged. Rules out inventing a new seam shape.
- The finalizer still awaits the gate to green before the first flip attempt, and awaits each retry; rules out backgrounding either step.
- Preserve the flat 1s backoff over three attempts and the retry notice text; rules out changing retry policy while changing the call shape.

## Acceptance criteria

- [ ] Neither the ready gate nor the draft-to-ready flip blocks the event loop: `v2/src/execution/ready-finalize.ts` imports no synchronous `node:child_process` API and awaits both subprocesses.
- [ ] The gate is awaited to success before the first flip attempt, and each of the up-to-three flip attempts is awaited.
- [ ] A non-zero async subprocess exit rejects with an error carrying the exit status and the captured `stdout`/`stderr`, covered by a test in `shared/subprocess.test.ts`; a gate whose output exceeds Node's default `maxBuffer` still succeeds.
- [ ] `v2/src/execution/ready-finalize.test.ts` stays green with its doubles made async (behavior unchanged by the conversion): retry count, flat backoff, retry notice, `already ready` / `not a draft` success guard, terminal failure propagation, and the `ready gate failed (exit N)` message with captured stderr.
- [ ] A rejected async gate seam surfaces as a ready-gate failure and no flip is attempted; a rejected async flip seam surfaces through `readyFinalizeError` in `v2/src/execution/write-loop.test.ts`.

## Documentation updates

- `v2/docs/write-behavior.md`: ready gate and draft-to-ready flip are asynchronous and awaited; ordering, retries, and failure text.
- `v2/docs/v1-behaviors.md`: record the v2 finalization behavior.
