# 00 - Bounded backoff between agent transient re-attempts

## Problem

`runAgent` (`v1/src/agents/spawn.ts`) retries transient agent errors up to
`TRANSIENT_RETRY_CAP = 2` (3 spawns) with **no backoff** — all attempts fire
back-to-back. A sustained provider overload (Anthropic 529/overloaded lasting
tens of seconds) is hit by every attempt inside the same few seconds, the cap
exhausts, and the run dies on `agent-error`. The sibling git/gh path already
added bounded backoff (`withSyncTransientRetry` / `runGhCommand`, `v1/src/gh.ts`);
the agent path should match so the two transient-retry paths are consistent.

This is about *spacing* the existing retries — classification
(`isTransientSignal`) and the model-config → quota → transient → error ordering
are unchanged. The cap widening (below) is a deliberate contract change to the
spawn-count/`cap` payload, not a no-op.

Numbering frame: re-attempt-indexed throughout. Re-attempt 1/2/3 are the 2nd/3rd/4th
spawns; the schedule entry at index `i` is slept before re-attempt `i+1`.

## Decisions

- Backoff is escalating, not fixed — spans a realistic overload window with few
  attempts (a flat 1s like git/gh barely spaces the attempts). Internal constant
  schedule `[1s, 2s, 4s]` slept before re-attempt 1/2/3; bounded, so the loop
  still terminates. (Rules out: fixed 1s, which leaves attempts clustered.)
- Widen `TRANSIENT_RETRY_CAP` 2 → 3 (4 total spawns) so the spaced attempts span
  ~7s of overload; still a hard cap. (Rules out: keeping cap 2, where backoff
  alone spans only ~3s.)
- Sleep injected behind an async seam on `AgentRunOptions` (default real sleep),
  mirroring the **async** `runGhCommand` / `sleepMs` seam — *not* the synchronous
  `withSyncTransientRetry` / `sleepSync` path the intent references, since
  `runAgent` is async. (Rules out: bare `setTimeout`, which forces real waits in
  tests; and a sync `sleepSync` copy, which blocks the event loop.)
- `onTransientRetry` fires *before* the backoff sleep — it signals "about to retry
  after a pause", and emitting it first keeps the existing call-order observable.
- Abort during a backoff sleep wins immediately: the sleep races `opts.signal`, so
  a Ctrl-C mid-sleep returns at once rather than waiting out up to 4s. (Rules out:
  a plain `await sleep` that ignores the signal, which would regress the current
  near-instant abort response.)
- Backoff only *between* attempts — no sleep after the final failed attempt, and
  the pre-sleep `signal.aborted` check still short-circuits before any wait.

## Task checklist

- [ ] Add an injectable async sleep seam to `AgentRunOptions` and `runAgent`;
      default to a real promise-based sleep that resolves early on `opts.signal`
      abort.
- [ ] Emit `onTransientRetry`, then sleep the escalating schedule (racing the
      abort signal) before each transient re-attempt; widen `TRANSIENT_RETRY_CAP`
      to 3.
- [ ] Guard: no sleep after the last attempt; pre-sleep `signal.aborted` check
      short-circuits.
- [ ] Update `v1/test/agents/spawn.sandbox-unrunnable.test.ts` (the existing
      cap-exhaustion test) for the new contract: inject a no-op/recorder sleep so
      it does not wall-clock ~7s; bump expected spawn count 3 → 4; update the
      `onTransientRetry` payload assertions to `cap: 3` and the new attempt count;
      rename the "cap of 2 retries" reference. This test absorbs the schedule
      assertion (assert the recorded `[1s, 2s, 4s]` spacing). The only net-new
      mechanism is the injected sleep recorder.
- [ ] Update `v2/docs/v1-behaviors.md` and `v1/docs/quota-signals.md`.

## Acceptance criteria

- [ ] `runAgent` waits via an injectable async sleep seam between transient
      re-attempts; `v1/test/agents/spawn.sandbox-unrunnable.test.ts` injects a
      recorder sleep and asserts the escalating `[1s, 2s, 4s]` schedule (no
      wall-clock sleep) with the spaced retries exhausted to a final
      `kind: "error"`.
- [ ] `v1/test/agents/spawn.sandbox-unrunnable.test.ts` is updated for the widened
      cap: expected spawn count is 4 (was 3), `onTransientRetry` payloads report
      `cap: 3`, and the "cap of 2 retries" naming is corrected. No transient test
      wall-clocks the schedule (all inject the seam).
- [ ] `TRANSIENT_RETRY_CAP` is widened so the spaced attempts span the overload
      window while remaining a hard bounded cap (4 total spawns).
- [ ] No backoff is taken after the final failed attempt; the pre-sleep
      `opts.signal.aborted` check short-circuits before any wait; and an abort
      arriving *during* a backoff sleep returns immediately (the sleep races the
      signal) rather than waiting out the remaining delay.
- [ ] `isTransientSignal` classification and the model-config → quota → transient →
      error ordering are unchanged: existing `v1/test/agents/quota.test.ts` and the
      `v1/test/run.test.ts` "agent stream handling" tests stay green.
- [ ] `onTransientRetry` fires once per transient re-attempt, *before* the backoff
      sleep, with the widened cap (`cap: 3`) reported in its `cap` field.
- [ ] `v2/docs/v1-behaviors.md` (patch-mode transient-retry entry) and
      `v1/docs/quota-signals.md` (transient transport errors section) state the
      agent transient-retry now backs off between attempts, matching the git/gh
      path, and record the new cap.

## Documentation updates

- `v2/docs/v1-behaviors.md` — the "Patch-mode transient transport error retry"
  entry currently says "no backoff" and "2 re-attempts (3 total spawns)"; update
  to the escalating backoff and widened cap.
- `v1/docs/quota-signals.md` — the "Transient transport errors" section (and the
  git/gh subsection note that "agent spawn deliberately had none") now describes
  the agent backoff and cap.
