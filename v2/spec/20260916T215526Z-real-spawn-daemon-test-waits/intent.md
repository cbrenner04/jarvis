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

## Outcome

Measured (`bun test <file>`, sandbox off, median of 3): merge base 25.3s combined (real-spawn 8.47s, changeover 10.11s, self-handoff 6.72s) → 19.57s (3.33s, 10.05s, 6.19s), ratio 0.77 (~23% cut). One-third target waived by operator 2026-09-17. `daemon-changeover` is flat: its floor is the kept 5.5s probe plus per-test boots. The spec's recorded ~30.8s base was wrong; the real base is 25.3s.

## Prerequisites
