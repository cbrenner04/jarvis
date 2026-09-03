# Shared isRecord and shrink step-id helpers

## Problem

`state-store.ts` defines a local `isRecord` guard for pipeline-context validation. `workflow-run-status-rollup.ts` hardcodes the hidden-shrink step-id suffix as a raw `~shrink` `endsWith` check. Downstream dedupe intents expect canonical homes in `shared/`; persistence should migrate first.

## Decisions

- `shared/is-record.ts` exports `isRecord`; rules out persistence-local or unnamed helper homes.
- `shared/shrink-step-id.ts` exports the hidden-shrink suffix constant plus `endsWith` and `strip` helpers; rules out raw `~shrink` literals and magic `slice` lengths in persistence rollup code.
- Scope is persistence only — rules out migrating daemon, execution, CLI, or TUI `isRecord` / shrink copies in this subspec (covered by separate ready-intents).
- Behavior-preserving: pipeline-context validation and shrink-failure rollup semantics stay byte-identical; rules out changing which sibling rows force `failed`.

## Tasks

- [ ] Add `shared/is-record.ts` exporting `isRecord(value: unknown): value is Record<string, unknown>` matching the existing persistence guard semantics.
- [ ] Add `shared/is-record.test.ts` covering object acceptance and array / null / primitive rejection.
- [ ] Add `shared/shrink-step-id.ts` exporting the hidden-shrink suffix constant plus `endsWith` and `strip` helpers aligned with `workflow-runner.ts` / `daemon.ts` usage today.
- [ ] Add `shared/shrink-step-id.test.ts` covering suffix detection and strip round-trip for representative step ids.
- [ ] `state-store.ts`: import `isRecord` from `shared/is-record.ts`; delete the local `function isRecord` definition.
- [ ] `workflow-run-status-rollup.ts`: import shrink helpers from `shared/shrink-step-id.ts`; replace the raw `endsWith("~shrink")` check.

## Acceptance criteria

- [x] `shared/is-record.test.ts` asserts the guard accepts plain objects and rejects arrays, `null`, and primitives; it fails against the pre-fix persistence-local definition remaining in `state-store.ts`.
- [x] `shared/shrink-step-id.test.ts` asserts suffix detection and strip behavior for representative hidden-shrink step ids; it fails against the pre-fix raw `~shrink` literal in `workflow-run-status-rollup.ts`.
- [x] `state-store.ts` imports `isRecord` from `shared/is-record.ts` with no local `function isRecord` definition reachable in the module.
- [x] `workflow-run-status-rollup.ts` imports shrink step-id helpers from `shared/shrink-step-id.ts` with no raw `~shrink` literal or local shrink-suffix logic reachable in the module.
- [x] `workflow-run-status-rollup.test.ts` stays green.

## Documentation updates

None — internal extraction with no operator-facing behavior change.
