# Workflow terminal evidence waits for every row

## Problem

The invocation finally path writes a settled marker even while a linked row remains non-terminal, producing a false finished incident.

## Decisions

- Write settled markers only when every durable row of the invocation is terminal; paused rows remain resumable and cannot certify completion. Apply the same guard to terminal incident resolution.

## Tasks

- [x] Implement the behavior and focused regression coverage.

## Acceptance criteria

- [x] daemon-workflow-admission-handlers.test.ts and operator-incidents.test.ts prove an active or paused sibling suppresses settled markers and finished incidents, while fully terminal invocations publish them; regression fails against pre-fix writers.
- [x] `bun run typecheck`, `bun run check`, `bun run lint:md` and `bun run test:v2` pass; integration coverage runs in CI.

## Documentation updates

- v2/docs/daemon-host.md and v2/docs/v1-behaviors.md state the all-row terminal boundary.
