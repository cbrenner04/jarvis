# Two admitted runs progress concurrently

`spawnWriteLoop` in `v2/src/daemon/daemon.ts` already fires each admitted
run's write loop as an independent fire-and-forget async task with its own
`AbortController`; nothing in the `start` path serializes admitted (non-queued)
runs against each other. `v2/docs/daemon-host.md` already documents "no global
single in-flight guard." What's missing is regression coverage that pins two
admitted runs actually overlapping in flight — existing tests
(`daemon-start-list.test.ts`) assert that a second `start` is *accepted* while
a first is active, but never assert both are simultaneously in-progress before
either completes, so a future change that accidentally re-serializes admission
would not be caught.

## Decisions

- Add coverage, not new production code — investigation confirmed no
  serialization to remove; this subspec pins the guarantee.
- Use the existing `createFakeWriteLoopExecutor` pattern (a manually-released
  pending promise) so the test can observe two runs held open simultaneously
  before releasing either.

## Task checklist

- [ ] Add a test asserting: start two runs for different `(project, branch)`
      keys, both remain pending (not yet settled) at the same time, and
      `list` reports both as live/in-progress simultaneously.
- [ ] Extend the test to settle one run's write loop and assert the other's
      live/in-progress status is unaffected (list shows one `completed`, the
      other still live).

## Acceptance criteria

- [ ] A test in `v2/src/daemon/daemon-start-list.test.ts` demonstrates two
      admitted runs for different `(project, branch)` keys are both live
      (`isLive: true` via `list`) at the same time, before either's write
      loop settles.
- [ ] Settling one run's write loop leaves the other run's live/in-progress
      status unaffected, observable via `list`.

## Documentation updates

- None. `v2/docs/daemon-host.md`'s "Admission guards for `start`, `resume`,
  `revise`" section already documents no global single in-flight guard; this
  subspec adds test coverage for already-documented behavior and changes no
  behavior, so `v2/docs/v1-behaviors.md` does not apply.
