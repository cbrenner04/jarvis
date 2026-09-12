# The refusal settlement records recovery state

## Problem

With the durable field in place (subspec 00), the refusal settlement itself still writes nothing into it: `finishGateInvocationRefused` in `v2/src/execution/write-loop.ts` commits `gate_invocation_refused` with only failure detail, and the terminal `loop_finished` entry carries `gateRefusalCause` / `gateCommand` but no slot re-drive count. Recovery reading the latest committed row after a restart still sees an undifferentiated refusal.

## Behavior

Settling a refused gate invocation writes the recovery state (cause, gate command, slot re-drive count) onto the run row as part of the same settlement, and the terminal `loop_finished` entry carries the same count alongside the cause it already records. The latest committed recovery state is what a later reader sees.

## Decisions

- Write the recovery state through the existing terminal settlement evidence on the refusal's `commitCompletionBoundary` call, so row status and recovery state commit in one transaction; rules out a follow-up update that a crash could split.
- The settlement carries forward the count already on the run row: the caller reads the current count via `loadRun` before constructing the evidence and passes it back verbatim (absent → omitted), consistent with 00's caller-supplied, store-never-computes decision; rules out resetting it to zero on each refusal, which would defeat bounding, and rules out a store-internal read-modify-write.
- Log and row carry the same cause and count; the row is authoritative for recovery and operator projection (00's outcome-gated projection is what makes this true after a resume), the log entry is evidence.
- A checkpoint failure that demotes the refusal to `iteration_commit_failed` writes no recovery state, matching the existing carve-out that suppresses `gateCommand`/`gateRefusalCause` on that path.

## Task checklist

- [ ] Extend the `loop_finished` event with the slot re-drive count.
- [ ] Pass recovery state through the refusal settlement's completion boundary, reading the run's current slot re-drive count via `loadRun` first.
- [ ] Tests in `write-loop.test.ts` and `log-stream.test.ts`.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` gains a test proving a `slot_contention` refusal and a `ceiling_headroom` refusal each leave the run row carrying that cause and its gate command, and that an existing slot re-drive count on the row survives the settlement; it fails against the pre-fix code, which persists no cause.
- [ ] `v2/src/persistence/log-stream.test.ts` gains a test proving a terminal `loop_finished` refusal entry round-trips the slot re-drive count alongside its cause and gate command; it fails against the pre-fix schema.
- [ ] A test proves a refusal whose controlled-loss checkpoint fails settles `iteration_commit_failed` with no recovery state written.
- [ ] `v2/docs/write-behavior.md` records that refusal settlement writes the recovery state and that the terminal log entry carries the count.
- [ ] `v2/docs/v1-behaviors.md` amends its existing `gateRefusalCause` entry (the "Gate-invocation refusal settlement carries `gateRefusalCause`..." bullet) to record the additive durable recovery state and slot re-drive count, rather than adding a second entry.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — refusal settlement writes durable recovery state; terminal log entry carries the count.
- `v2/docs/v1-behaviors.md` — amend the existing `gateRefusalCause` entry with the additive durable recovery state and slot re-drive count (v1 has no gate accounting).
