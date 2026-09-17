---
name: real-spawn-daemon-test-waits
---

# Real-spawn daemon test waits

`daemon-self-handoff-real-spawn` (14.0s), `daemon-changeover` (10.1s), and `daemon-self-handoff` (6.7s) wait on fixed sleeps and bounded polls and boot a daemon per test.

## Decisions

- Use the smallest sampling/poll intervals the contract allows; replace fixed sleeps with condition waits.
- Share a daemon boot within a file where tests don't need a fresh one.
- Real-process coverage unchanged.

## Acceptance criteria

- [ ] The three files' combined time drops by at least a third, with the same test titles passing.
- [ ] Test count per slice is unchanged or higher versus the merge base.
- [ ] `bun run typecheck`, `bun run test`, and `bun run check` pass.

## Documentation updates

- `v2/docs/test-writing.md` — real-spawn wait guidance; note before/after combined time.

## Blocker

Subspec 03 could not obtain a real combined `bun test <file>` measurement: this implement session's sandbox denies Unix-socket binds under `tmpdir()` (`EPERM`) and unconditionally refuses `dangerouslyDisableSandbox`, so none of the three files can run with a real socket/process. A static estimate counting only the landed diffs' guaranteed fixed-value sleep reductions (~5.68s off the ~30.8s merge-base combined time, ~25.1s estimated) falls short of the ~20.53s (two-thirds) target by ~4.6s; the gap depends on unquantifiable `waitFor` poll-interval and condition-wait speedups that only a real run can settle. See `03-combined-time-and-docs.md`'s Blocker for detail. Needs an operator run outside the sandbox to produce the real number.

## Prerequisites
