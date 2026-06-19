# Prompt-mode orphan reaping

## Problem

Prompt mode (`v1/src/modes/prompt/run.ts`) spawns its agent through the same
detached process-group path as the patch loop, so a tool that re-parents a
descendant to init (PPID=1, escaping the watchdog's `-pgid` kill) leaks an
orphan. The marker-free `DescendantTracker` reap (`v1/src/modes/patch/reap.ts`)
is wired only into the patch loop; prompt invocations leave such orphans behind.

## Decisions

- Reuse `DescendantTracker` from `v1/src/modes/patch/reap.ts`; do not fork a
  prompt-specific reaper. Rules out a divergent second implementation.
- Reap per agent invocation: each attempt in the fallback loop gets a tracker
  that polls on spawn + interval and reaps in that attempt's `finally`. Rules
  out a single run-spanning tracker (prompt mode is single-pass; each agent
  attempt is its own invocation).
- Poll on `onSpawned` then on a fixed interval, matching the patch loop, so
  escapees are recorded while their lineage is intact.
- Best-effort and non-fatal: a reap (or poll) throw is swallowed and never
  alters the prompt exit code or reason. Rules out letting reap errors surface.
- Expose a test-only reap override on prompt run options (mirroring the patch
  loop's `__testReapFn`) so the non-fatal guarantee is testable without real
  orphans.
- Source the poll interval from a single shared location rather than copying the
  `500` literal. The literal currently lives as a private constant in
  `patch/run.ts`; relocate it to an export from `reap.ts` (already in the reused
  dependency surface) and re-point the patch loop's import. This edits
  `patch/run.ts` — outside the intent's declared scope — a deliberate one-line
  re-point, not a silent leak. Rules out copying the literal into a third file.
- Wrap each agent attempt in a new per-attempt `try/finally` inside the fallback
  loop, distinct from the existing outer `finally` (lock release + telemetry).
  The interval-clear and reap sit in this per-attempt `finally` so every exit
  branch is covered: quota continue, success break, watchdog-timeout break,
  model-config continue, error break. Rules out conflating the reap with the
  outer finally or missing a branch. The watchdog-timeout branch is the
  highest-value target — it follows a process-group kill that scatters escapees.

## Task checklist

- [ ] Instantiate a `DescendantTracker` per agent attempt in
  `v1/src/modes/prompt/run.ts`; poll in `onSpawned`, then on an interval (unref
  the handle).
- [ ] Add a per-attempt `try/finally` inside the fallback loop; clear the poll
  interval and reap in that `finally`, wrapped so throws are swallowed. Confirm
  it covers every exit branch (quota continue, success break, watchdog-timeout
  break, model-config continue, error break), not just the happy path.
- [ ] Add a test-only reap override to prompt run options.
- [ ] Relocate the poll-interval constant to an export from `reap.ts` and
  re-point the patch loop's import in `patch/run.ts`.
- [ ] Update docs.

## Verification

Real-kill behavior (a recorded PPID=1 orphan actually receiving SIGKILL) is
already covered by the existing `DescendantTracker` unit tests and is not
re-tested here: injecting the reap override replaces the real reap, so the seam
cannot exercise a real kill. New prompt-mode tests use the override to assert
the wiring instead — polling on spawn + interval, reap invoked in the
per-attempt `finally`, and non-fatality.

## Acceptance criteria

- [ ] Prompt mode polls the tracker on spawn and on the interval, and invokes
  reap in the per-attempt `finally` on every exit branch — including the
  watchdog-timeout break — observed via the injected reap override.
- [ ] A reap failure during a prompt-mode invocation does not change the prompt
  exit code or reason.
- [ ] `bun run typecheck` and `bun test` pass; existing prompt tests still pass.

## Documentation updates

- `v1/docs/run-loop.md`: in the orphan-reaping section, note prompt-mode
  invocations reap re-parented orphans via the same mechanism.
- `v2/docs/v1-behaviors.md`: record that prompt-mode invocations reap
  re-parented agent orphans (cite `v1/src/modes/prompt/run.ts`).
