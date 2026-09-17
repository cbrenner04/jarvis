# Combined time and docs

Depends on 00, 01, and 02 landing first: this subspec measures the combined effect of all three rewrites and updates the shared doc.

## Decisions

- Merge-base combined time is ~30.8s (`daemon-self-handoff-real-spawn` ~14.0s + `daemon-changeover` ~10.1s + `daemon-self-handoff` ~6.7s), each measured via `bun test <file>` on the same machine.
- A one-third cut is ~10.3s. Two windows stay fixed by design — the 5.5s changeover probe (01) and the shrunk ~successor-outlives-incumbent window in the real-spawn file (00, floored below 5s) — together already ~10.5s of the base. The rest of the required cut has to come from lowered poll intervals, shortened negative-window sleeps, and condition waits resolving faster than the fixed sleeps they replace.
- If the measured combined cut comes in under one-third, file a `## Blocker` in `intent.md` naming the shortfall instead of weakening the target.

## Acceptance criteria

- [ ] Combined `bun test <file>` time for the three files (same machine, summed) is at most two-thirds of the recorded merge-base combined time (~30.8s), or a `## Blocker` is filed in `intent.md` naming the measured shortfall.
- [ ] `v2/docs/test-writing.md` gains real-spawn wait guidance: condition waits over fixed sleeps, fixed sleeps only for negative windows sized to the interval they cover, smallest poll step the contract allows, and the merge-base vs post-change combined time.
- [ ] `bun run typecheck`, `bun run test`, and `bun run check` pass.

## Documentation updates

- `v2/docs/test-writing.md` — real-spawn wait guidance; merge-base vs post-change combined time.
