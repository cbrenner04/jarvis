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

## Blocker

This session's sandbox cannot produce a real `bun test <file>` wall-clock for any of the three files: Unix-socket binds under `tmpdir()` return `EPERM` (reproduced directly with a bare `net.createServer().listen()`, and independently via the pre-existing, unrelated `v2/src/ipc/server.test.ts` failing the same way), and `dangerouslyDisableSandbox` is unconditionally refused in this session — confirmed via repeated direct attempts and an independent subagent probe, both returning "Run outside of the sandbox". `bun test <file>` in-sandbox just reports the lone test skipped (`canUseUnixSockets()` is false), not a real duration.

A static estimate from the landed 00/01/02 diffs, counting only guaranteed fixed-value reductions (not the unquantifiable `waitFor` poll-interval or condition-wait speedups): `daemon-self-handoff-real-spawn` ~5.15s (5000ms post-exit sleep → a ~100ms three-sample loop; 300ms negative window → 50ms), `daemon-self-handoff` ~0.53s (five negative windows cut from 150-200ms to 40-100ms), `daemon-changeover` ~0s guaranteed (both changes there are condition-wait replacements, not fixed-value cuts). That totals ~5.68s off the ~30.8s merge-base combined time — an estimated ~25.1s, short of the ~20.53s (two-thirds) bar by ~4.6s on guaranteed savings alone. Whether the untouched poll-interval/condition-wait speedups close that gap can only be settled by an actual run.

Needs an operator (or a session with sandbox disabled) to run `bun test` on each of the three files, sum the wall-clock, and either tick AC 1 with the real figure and fill in `test-writing.md`'s post-change time, or record the shortfall in `intent.md` per this subspec's own Decision.

`bun run typecheck` and `bun run check` pass clean. `bun run test:v2` fails only on the pre-existing, unrelated `v2/src/ipc/server.test.ts` (same `EPERM` root cause, untouched by this spec, not gated by `canUseUnixSockets()`).
