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
  `500` literal, to keep one cadence across modes.

## Task checklist

- [ ] Instantiate a `DescendantTracker` per agent attempt in
  `v1/src/modes/prompt/run.ts`; poll in `onSpawned`, then on an interval (unref
  the handle).
- [ ] Clear the poll interval and reap in the attempt's `finally`, wrapped so
  throws are swallowed.
- [ ] Add a test-only reap override to prompt run options.
- [ ] Share the poll-interval constant (export from `reap.ts` or a shared module
  consumed by both patch and prompt).
- [ ] Update docs.

## Acceptance criteria

- [ ] A prompt-mode invocation whose agent left a re-parented orphan (PPID=1,
  recorded while its lineage was intact) SIGKILLs that orphan when the
  invocation ends.
- [ ] A reap failure during a prompt-mode invocation does not change the prompt
  exit code or reason.
- [ ] `bun run typecheck` and `bun test` pass; existing prompt tests still pass.

## Documentation updates

- `v1/docs/run-loop.md`: in the orphan-reaping section, note prompt-mode
  invocations reap re-parented orphans via the same mechanism.
- `v2/docs/v1-behaviors.md`: record that prompt-mode invocations reap
  re-parented agent orphans (cite `v1/src/modes/prompt/run.ts`).
