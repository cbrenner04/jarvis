---
name: v2-structure-merges
---

# Optional: micro-file merges and daemon.ts extraction

**Skippable.** Run only if, after seeds 02–12, v2 still reads as fragmented. The cost being cut is file count and navigation, not LOC (~0 net).

## Decisions

- Merge micro-files into their consumer: `tui-daemon-errors.ts` (31) + the rpc transport → `tui-daemon-client.ts` (unless seed 11 relocated the transport for cli reuse — then it stays standalone); `tui-log-follow-types.ts` + `tui-log-follow-lines.ts` → `tui-log-follow-entry.tsx`; `telemetry-sink.ts` (13) → `write-loop.ts`; `invocation-failure.ts` (17) → `step-runner.ts`.
- daemon.ts: if still unwieldy after 02/11/12 (~800 lines expected), extract the two self-contained regions — revise/reconverge (+ `buildRevisionWriteLoopInput`, ~200) and list-snapshot assembly (~150). Extraction adds files; skip if reading no longer hurts.
- Docs: `v2-architecture.md` domain map for any moves.

## Out of scope

- Any behavior change; any new abstraction layers.

## Ordering

13 — last; explicitly skippable.
