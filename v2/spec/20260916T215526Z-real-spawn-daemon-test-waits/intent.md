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

## Prerequisites
