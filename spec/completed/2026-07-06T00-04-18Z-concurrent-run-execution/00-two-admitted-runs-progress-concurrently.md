# Two admitted runs progress concurrently

**Scope note:** the intent asks the daemon to "execute multiple admitted runs
in parallel rather than serializing them." Investigation found this already
ships — no production code change is needed here. This subspec is regression
coverage only, pinning the existing guarantee so it can't silently regress.

`spawnWriteLoop` (`v2/src/daemon/daemon.ts:512-543`) fires each admitted run's
write loop as an independent fire-and-forget async IIFE (`:520-542`) with its
own `AbortController`. `startHandler` (`:551-612`) rejects a second `start`
only for the *same* `(project, branch)` key, via `checkWorktreeClaimed`
(`:573`); it has no lock across different keys, so `spawnWriteLoop` (called
at `:608`) runs concurrently for distinct keys. `v2/docs/daemon-host.md`
already documents "no global single in-flight guard." What's missing is
regression coverage that pins two admitted runs actually overlapping in
flight — existing tests (`daemon-start-list.test.ts`) assert that a second
`start` is *accepted* while a first is active, but never assert both are
simultaneously in-progress before either completes, so a future change that
accidentally re-serializes admission would not be caught.

## Decisions

- Add coverage, not new production code — investigation confirmed no
  serialization to remove; this subspec pins the guarantee.
- Use the existing `createFakeWriteLoopExecutor` pattern (a manually-released
  pending promise) so the test can observe two runs held open simultaneously
  before releasing either.

## Task checklist

- [x] Add a test asserting: start two runs for different `(project, branch)`
      keys, both remain pending (not yet settled) at the same time, and
      `list` reports both as live/in-progress simultaneously.
- [x] Extend the test to settle one run's write loop and assert the other's
      live/in-progress status is unaffected (list shows one `completed`, the
      other still live).

## Acceptance criteria

- [x] A test in `v2/src/daemon/daemon-start-list.test.ts` starts two runs for
      different `(project, branch)` keys against a fake write-loop executor
      whose returned promises are held pending (unreleased) for both runs
      simultaneously — i.e. neither run's executor promise has resolved when
      both are asserted `isLive: true` via `list` — proving both write loops
      are genuinely in flight at once, not merely reported live.
- [x] Releasing (resolving) only the first run's pending executor promise
      settles that run to `completed` while the second run's executor
      promise is still unreleased and its `list` status remains live,
      confirming settlement is independent per run rather than coupled to a
      shared gate.

## Documentation updates

- None. `v2/docs/daemon-host.md`'s "Admission guards for `start`, `resume`,
  `revise`" section already documents no global single in-flight guard; this
  subspec adds test coverage for already-documented behavior and changes no
  behavior, so `v2/docs/v1-behaviors.md` does not apply.
