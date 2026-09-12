---
name: report-gate-refusal-causes
---

# Report gate-refusal cause and retry state

## Prerequisites

- The write loop distinguishes slot contention from ceiling-headroom refusal at the refusal site and checkpoints a quiesced slot-refused iteration before committing its refusal boundary.
- Durable run evidence round-trips the gate-refusal cause and slot re-drive count, including across daemon restart.
- The daemon re-drives slot-contention refusals when a lease becomes available, stops at a fixed bound with every re-drive logged, and never auto-re-drives ceiling-headroom refusals.

## Module-boundary surface

- Operator observation: daemon `list`/`wait` error projection and CLI presentation.

## Problem

`jarvis run list` and `jarvis run wait` expose one `gate_invocation_refused` error and one resume instruction. Operators cannot distinguish a headroom refusal from bounded slot recovery or tell how many automatic attempts a slot-refused lane consumed.

## Behavior

- `jarvis run list` and `jarvis run wait` identify the gate-refusal cause, report slot re-drive count and bound when applicable, and reserve the ordinary resume remedy for ceiling-headroom refusal.

## Decisions

- Project cause, count, and bound from durable recovery evidence through the shared run operator error; rules out CLI inference from prose.
- Keep `gate_invocation_refused` as the stable reason while making its cause explicit.
- Report bounded slot exhaustion as distinct operator diagnosis rather than claiming the headroom-clears resume remedy.
- Preserve existing list columns and wait JSON outside the added refusal detail.

## Acceptance criteria

- [ ] Daemon list/wait tests prove ceiling-headroom and slot-bound-exhausted refusals expose distinct causes, and slot refusal exposes its count and bound; they fail against the pre-fix undifferentiated operator error.
- [ ] CLI tests prove `run list` renders the cause and slot count/bound while `run wait` preserves the same structured fields.
- [ ] A recovery test proves only ceiling-headroom refusal advertises the ordinary gate-refusal resume remedy.
- [ ] Existing non-gate operator-error and run list/wait tests stay green: `v2/src/daemon/run-operator-error.test.ts` and `v2/src/commands/run.test.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Concurrency cause/count output and cause-specific recovery.
- `v2/docs/write-behavior.md` — run list/wait projection for differentiated refusals.
- `v2/docs/v1-behaviors.md` — record the v2 operator-visible cause and bounded retry evidence.
