# 00 - Shared socket test fixture

Extract the duplicated Unix-socket capability probe and `skipIfNoSockets`
wrapper from socket-backed v2 tests into `v2/src/testing/`, then migrate those
tests to import the shared fixture without changing assertions.

## Prerequisites

- `v2/docs/test-writing.md` distinguishes agent-runnable tests from sandbox-unrunnable tests.

## Decisions

- One shared fixture under `v2/src/testing/` — rules out per-file probe blocks in `ipc.test.ts`, `daemon.sandbox-unrunnable.test.ts`, and `daemon-start-list.test.ts`.
- Export settled Unix-socket availability (same role as today's `canCreateSockets`) alongside `skipIfNoSockets` — rules out exporting the wrapper alone while hooks still need the flag.
- Deferred to first consumer: socket probe evaluation timing — pin when a caller needs it.
- Preserve existing skip semantics (early return, not hard failure) — rules out turning unavailable sockets into hard failures.
- Stderr skip messages stay caller-owned (file-local emission or per-caller hook); shared fixture supplies settled availability only — rules out shared probe writing on failure (collapses distinct messages to import order).
- Defer `test.skipIf` adoption and silent-pass doc reversal to `v2-socket-tests-skip-honestly` — rules out migrating skip mechanism in this spec.
- Touch only the three files that currently duplicate the probe today — rules out opportunistic migration of other v2 tests.
- Document fixture ownership in `v2/docs/test-writing.md` — rules out discoverability by import search only.
- No production or operator behavior change — rules out `v2/docs/v1-behaviors.md` update.

## Tasks

- Add a shared Unix-socket probe under `v2/src/testing/` exporting settled availability (`canCreateSockets` role) and `skipIfNoSockets`.
- Doc-comment every exported fixture symbol per `v2/docs/documentation-standard.md`.
- Migrate `v2/src/ipc/ipc.test.ts` to import the shared fixture; remove its local probe block and `skipIfNoSockets` copy.
- Migrate `v2/src/daemon.sandbox-unrunnable.test.ts` to import the shared fixture; remove its local probe block and `skipIfNoSockets` copy.
- Migrate `v2/src/daemon-start-list.test.ts` to import the shared fixture; remove its local probe block and `skipIfNoSockets` copy.
- Update `v2/docs/test-writing.md` to list shared socket fixtures under `v2/src/testing/` and when v2 tests should use them (aligned with agent-runnable vs sandbox-unrunnable conventions).

## Acceptance criteria

- [x] `ipc.test.ts` stays green (behavior unchanged by the extraction).
- [x] `daemon.sandbox-unrunnable.test.ts` stays green (behavior unchanged by the extraction).
- [x] `daemon-start-list.test.ts` stays green (behavior unchanged by the extraction).
- [x] `ipc.test.ts`, `daemon.sandbox-unrunnable.test.ts`, and `daemon-start-list.test.ts` contain no local Unix-socket probe block or local `skipIfNoSockets` copy; each imports shared settled availability and `skipIfNoSockets`.
- [x] Shared fixture exports settled Unix-socket availability and `skipIfNoSockets`; every exported symbol has a doc-comment per `v2/docs/documentation-standard.md`.
- [x] `v2/docs/test-writing.md` documents shared socket fixtures under `v2/src/testing/` and when v2 socket-backed tests should import them.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/test-writing.md` — shared socket fixture location and usage guidance.
- Shared fixture module — doc-comments on exported symbols per `v2/docs/documentation-standard.md`.
