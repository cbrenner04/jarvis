# Self-handoff real-spawn waits

`v2/src/daemon/daemon-self-handoff-real-spawn.sandbox-unrunnable.test.ts` (~14.0s) has one test. It polls at 50ms and holds a fixed 5s "successor outlives incumbent" sleep plus a 300ms negative-window sleep.

## Decisions

- Shrink the 5s post-exit sleep to the shortest window that still proves the successor outlives its spawner: at least 3 alive+health samples taken after the incumbent's process has exited and its process group has torn down, not merely alive at the instant of exit — dropping it loses the regression it guards.
- Negative windows ("nothing hands off while unchanged") stay fixed sleeps sized to one digest-sampling interval, not condition waits — absence cannot be awaited.
- Lower the `waitFor` step to 20ms, matching sibling files; leave caps alone (they only bound failure time).
- Boot sharing does not apply: the file has one test, and that test hands off, so nothing survives to share with a second test.
- Timing method: `bun test v2/src/daemon/daemon-self-handoff-real-spawn.sandbox-unrunnable.test.ts` on the same machine, merge base vs after — not the aggregate gate's time.

## Acceptance criteria

- [x] `bun test v2/src/daemon/daemon-self-handoff-real-spawn.sandbox-unrunnable.test.ts` runs faster than the same command at the merge base, with identical test titles and test count unchanged or higher.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass; this file itself runs under `test:integration:v2` (the `.sandbox-unrunnable.test.ts` suffix routes it there, not `test:v2`) — run with the sandbox disabled (writable `/tmp`, Unix sockets).

## Documentation updates

- None here; `v2/docs/test-writing.md` is updated in the final subspec.
