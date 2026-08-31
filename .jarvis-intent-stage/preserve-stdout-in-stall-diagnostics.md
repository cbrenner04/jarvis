---
name: preserve-stdout-in-stall-diagnostics
---

# Preserve streamed stdout in stall diagnostics

Unsplit rationale: the fix lives entirely in shared invocation stall settlement (one execution-loop surface); the session-log writer already records non-ok diagnostics verbatim, and persistence, daemon, and CLI contracts are untouched.

## Primary implementation surface

- execution-loop — shared invocation idle-stall settlement (`shared/invocation/agents.ts`)

## Prerequisites

## Problem

When the idle-output watchdog fires, stall settlement carries only the accumulated stderr; the accumulated stdout is dropped. `logBindingInbound` appends only `result.stderr` for non-ok results, so a stdout-streaming lane (cursor runs `--output-format stream-json --stream-partial-output`) logs zero inbound bytes after the binding line — reading as "the agent never produced output" when it streamed minutes of work (issue #3151, run `0364af43-86ec-4587-a5ac-2e705dc2beff`).

## Behavior

- Both idle-stall paths — immediate settle and the child-joining forced result — carry the accumulated stdout alongside stderr in the stall result's diagnostics, so the session log shows what the stalled agent actually emitted.
- An empty inbound entry on a stalled lane now means real silence.
- Watchdog timing, re-arming, process handling, and `kind: "stall"` classification are unchanged.

## Decision ledger

- Carry the diagnostics in the existing stall `stderr` field as `${errBuf}${outBuf}`, matching the zero/non-zero settle branches; rules out a new result field or a stall-specific branch in `logBindingInbound`.
- Leave watchdog firing and stall classification alone; rules out folding this into timeout-budget policy work.

## Acceptance criteria

- [ ] An invocation that streams stdout, emits no stderr, then idles past `idleOutputMs` settles a `stall` whose diagnostics contain the streamed stdout — in both the immediate and `joinProcessOnIdleStall` paths; the test fails against stderr-only stall settlement.
- [ ] The session log for that stalled binding records the streamed stdout in its inbound entry.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, `bun run test:integration:v2` pass (shared surface).

## Documentation updates

- `v2/docs/operator-runbook.md` — `role_stalled` / `idle_output_timeout` diagnosis notes that the session log carries the stalled agent's streamed stdout, so an empty inbound entry is real silence, not a discarded buffer.
- `v2/docs/v1-behaviors.md` — record the corrected shared stall-diagnostics behavior in the parity baseline.
