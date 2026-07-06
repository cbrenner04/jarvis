---
name: consolidate-state-store-types
---

# Consolidate state-store types into one module

`state-store-types.ts` holds a stale duplicate half: second `AttemptStatus` (drifted from `state-store.ts`), second `OutcomeKind`/`Run`/`Attempt`, unused `Outcome`, and a stale `StateStore` interface whose signatures no longer match the real store. Move survivors (`RunStatus`, `isRunStatus`, `OnReviseConfig`, `WorkflowSnapshot`/`WorkflowSnapshotStep`, one `OutcomeKind`) into `state-store.ts`, update imports, delete `state-store-types.ts`. Type-only imports preserve the persistence/execution boundary.

## Decisions

- Delete stale duplicate types and stale `StateStore` interface — rules out keeping drifted parallel definitions.
- Colocate survivors in `state-store.ts` — rules out a third types module or barrel re-export layer.
- Delete `state-store-types.ts` after migration — rules out leaving an empty or partial stub file.
- Type-only imports at persistence/execution boundary — rules out runtime coupling changes.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are landed (seed 01)

## Documentation updates

- `v2/docs/v2-architecture.md` — persistence domain map drops `state-store-types.ts`
- `v2/docs/state-store.md` — only if it names `state-store-types.ts` after inspection

## Verification

- `bun run typecheck`, `test:v2`, `test:integration:v2`
