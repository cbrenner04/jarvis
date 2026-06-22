# 00 - Bounded backoff between agent transient re-attempts

## Problem

`runAgent` (`v1/src/agents/spawn.ts`) retries transient agent errors up to
`TRANSIENT_RETRY_CAP = 2` (3 spawns) with **no backoff** — all attempts fire
back-to-back. A sustained provider overload (Anthropic 529/overloaded lasting
tens of seconds) is hit by every attempt inside the same few seconds, the cap
exhausts, and the run dies on `agent-error`. The sibling git/gh path already
added bounded backoff (`withSyncTransientRetry` / `runGhCommand`, `v1/src/gh.ts`);
the agent path should match so the two transient-retry paths are consistent.

This is purely about *spacing* the existing retries — classification
(`isTransientSignal`), the quota/model-config ordering, abort handling, and the
`onTransientRetry` callback contract are unchanged.

## Decisions

- Backoff is escalating, not fixed — spans a realistic overload window with few
  attempts (a flat 1s like git/gh barely spaces 3 attempts). Internal constant
  schedule `[1s, 2s, 4s]` applied before re-attempts 2/3/4; bounded, so the loop
  still terminates. (Rules out: fixed 1s, which leaves attempts clustered.)
- Widen `TRANSIENT_RETRY_CAP` 2 → 3 (4 total spawns) so the spaced attempts span
  ~7s of overload; still a hard cap. (Rules out: keeping cap 2, where backoff
  alone spans only ~3s.)
- Sleep injected behind a seam on `AgentRunOptions` (default real sleep), reusing
  the git/gh `sleepMs` pattern, so tests assert spacing without wall-clock sleep.
  (Rules out: bare `setTimeout`, which forces real waits in tests.)
- Backoff only *between* attempts — no sleep after the final failed attempt and
  none when aborted (mirrors git/gh, and abort already returns immediately).

## Task checklist

- [ ] Add an injectable sleep seam to `AgentRunOptions` and `runAgent`; default to
      a real promise-based sleep.
- [ ] Sleep the escalating schedule before each transient re-attempt; widen
      `TRANSIENT_RETRY_CAP` to 3.
- [ ] Guard: no sleep after the last attempt; no sleep on abort.
- [ ] Add a test driving runAgent with an injected spawn that returns a transient
      error and an injected sleep recorder; assert the schedule and that the final
      result is the transient `kind: "error"`.
- [ ] Update `v2/docs/v1-behaviors.md` and `v1/docs/quota-signals.md`.

## Acceptance criteria

- [ ] `runAgent` waits via an injectable sleep seam between transient re-attempts;
      a test asserts the escalating backoff schedule is observed via the injected
      seam (no wall-clock sleep) and that the spaced retries are exhausted to a
      final `kind: "error"`.
- [ ] `TRANSIENT_RETRY_CAP` is widened so the spaced attempts span the overload
      window while remaining a hard bounded cap (4 total spawns).
- [ ] No backoff is taken after the final failed attempt, and none when the run is
      aborted (`opts.signal.aborted`).
- [ ] `isTransientSignal` classification and the model-config → quota → transient →
      error ordering are unchanged: existing `v1/test/agents/quota.test.ts` and the
      `v1/test/run.test.ts` "agent stream handling" tests stay green.
- [ ] `onTransientRetry` still fires once per transient re-attempt, with the
      widened cap reported in its `cap` field.
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
