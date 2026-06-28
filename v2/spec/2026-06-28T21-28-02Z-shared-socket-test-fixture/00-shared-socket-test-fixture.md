# 00 - Shared socket test fixture

Extract the duplicated Unix-socket capability probe and `skipIfNoSockets`
wrapper from socket-backed v2 tests into `v2/src/testing/`, then migrate those
tests to import the shared fixture without changing assertions.

## Decisions

- One shared fixture under `v2/src/testing/` — rules out per-file probe blocks in `ipc.test.ts`, `daemon.sandbox-unrunnable.test.ts`, and `daemon-start-list.test.ts`.
- Deferred to first consumer: socket probe evaluation timing — pin when a caller needs it.
- Preserve existing skip semantics (early return, not hard failure) and stderr skip messages where a file already emits them — rules out `test.skipIf` migration and rules out homogenizing `ipc.test.ts` / `daemon.sandbox-unrunnable.test.ts` stderr text into one shared string.
- Touch only the three files that currently duplicate the probe today — rules out opportunistic migration of other v2 tests.
- Document fixture ownership in `v2/docs/test-writing.md` — rules out discoverability by import search only.
- No production or operator behavior change — rules out `v2/docs/v1-behaviors.md` update.

## Tasks

- Add a shared Unix-socket probe and `skipIfNoSockets` export under `v2/src/testing/`.
- Migrate `v2/src/ipc/ipc.test.ts` to import the shared fixture; remove its local probe block and `skipIfNoSockets` copy.
- Migrate `v2/src/daemon.sandbox-unrunnable.test.ts` to import the shared fixture; remove its local probe block and `skipIfNoSockets` copy.
- Migrate `v2/src/daemon-start-list.test.ts` to import the shared fixture; remove its local probe block and `skipIfNoSockets` copy.
- Update `v2/docs/test-writing.md` to list shared socket fixtures under `v2/src/testing/` and when v2 tests should use them.

## Acceptance criteria

- [ ] `ipc.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `daemon.sandbox-unrunnable.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `daemon-start-list.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `ipc.test.ts`, `daemon.sandbox-unrunnable.test.ts`, and `daemon-start-list.test.ts` contain no local Unix-socket probe block or local `skipIfNoSockets` copy.
- [ ] `v2/docs/test-writing.md` documents shared socket fixtures under `v2/src/testing/` and when v2 socket-backed tests should import them.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/test-writing.md` — shared socket fixture location and usage guidance.
