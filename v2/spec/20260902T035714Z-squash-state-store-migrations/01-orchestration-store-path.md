# Orchestration store path constant

## Problem

`openStateStore` re-derives the default orchestration SQLite path as `join(jarvisHome(), "state", "v2.sqlite")` inline. `paths.ts` already centralizes other `~/.jarvis` locations; the store path should live there too.

## Decisions

- Export the default orchestration store path from `v2/src/paths.ts`; rules out hand-rolled `join(jarvisHome(), "state", "v2.sqlite")` at persistence call sites.
- Export a `jarvisHomeDir`-parameterized builder alongside the default constant so isolated-home tests can derive the same relative layout without duplicating `"state"` / `"v2.sqlite"` segments; rules out a constant-only export that forces test call sites to keep inline joins.
- Migrate `openStateStore` and `v2/src/testing/write-fixtures.ts` `createJarvisHome`; rules out leaving any persistence-adjacent inline default path after this subspec.
- Behavior-preserving: default-path opens still target `~/.jarvis/state/v2.sqlite`; rules out changing on-disk layout or filename.

## Tasks

- [ ] `paths.ts`: export `orchestrationStorePath(jarvisHomeDir?: string)` and `ORCHESTRATION_STORE_PATH` (`orchestrationStorePath()`).
- [ ] `paths.test.ts`: assert `ORCHESTRATION_STORE_PATH` equals `join(jarvisHome(), "state", "v2.sqlite")` under the test home override and that `orchestrationStorePath(customHome)` preserves the `state/v2.sqlite` suffix.
- [ ] `state-store.ts` `openStateStore`: use `ORCHESTRATION_STORE_PATH` for the default `storePath`.
- [ ] `write-fixtures.ts` `createJarvisHome`: derive `stateDbPath` through `orchestrationStorePath(jarvisRoot)`.

## Acceptance criteria

- [ ] `paths.test.ts` asserts `ORCHESTRATION_STORE_PATH` and `orchestrationStorePath(customHome)` literal values; it fails against the pre-fix inline `join(jarvisHome(), "state", "v2.sqlite")` default in `state-store.ts`.
- [ ] `state-store.ts` imports the default orchestration store path from `paths.ts` with no inline `join(jarvisHome(), "state", "v2.sqlite")` reachable in `openStateStore`.
- [ ] `write-fixtures.ts` derives `stateDbPath` through `orchestrationStorePath` with no inline `"state"` / `"v2.sqlite"` join reachable in `createJarvisHome`.
- [ ] `state-store.test.ts` stays green.

## Documentation updates

None — path value unchanged; operator docs already name `~/.jarvis/state/v2.sqlite`.
