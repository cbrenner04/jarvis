# 02 — Terminal-publication gate holds the slot

## Problem

The terminal-publication ready gate path runs the same full-suite ready command without acquiring the daemon gate lease, so it can overlap agent or finalization gates.

## Decisions

- The terminal-publication ready gate path in `terminal-publication.ts` awaits the gate invocation lease before spawn and releases in `finally`, including on a red gate outcome; rules out scoped verifier or probe runs taking the slot (unchanged from today).

## Task checklist

- [ ] Lease wait/release around terminal-publication `runReadyGate` spawn only.
- [ ] Regression test in `terminal-publication.test.ts`.

## Acceptance criteria

- [x] `v2/src/execution/terminal-publication.test.ts` proves the terminal-publication ready gate acquires and releases the lease, including when the gate fails; fails against pre-fix code that spawns without a lease (reachable on main today).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — terminal-publication ready gate participates in the same per-daemon full-suite slot as agent and finalization gates.
- `v2/docs/v1-behaviors.md` — terminal-publication gate holds the daemon gate slot.
