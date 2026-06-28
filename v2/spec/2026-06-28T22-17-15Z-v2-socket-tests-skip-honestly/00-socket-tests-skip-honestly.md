# 00 - Socket tests skip honestly

Migrate v2 socket-backed tests from silent-return `skipIfNoSockets` wrappers
to Bun `test.skipIf` so unavailable Unix sockets report skipped, not pass.

## Prerequisites

- `v2/src/testing/unix-socket.ts` exports a shared settled Unix-socket
  availability probe (`canCreateSockets` role today).

## Decisions

- Gate socket-dependent tests with `test.skipIf(!canUseUnixSockets(), ...)` — rules out `skipIfNoSockets` early returns that report pass.
- Export `canUseUnixSockets(): boolean` as the canonical probe accessor; remove `canCreateSockets` and `skipIfNoSockets` — rules out dual naming or keeping the silent-return wrapper.
- Touch only `ipc.test.ts`, `daemon-start-list.test.ts`, and `daemon.sandbox-unrunnable.test.ts` plus the shared fixture — rules out v1/shared sandbox-unrunnable migration or opportunistic v2 test edits.
- Keep file-local `socketProbeErrored` stderr emission unchanged — rules out moving operator skip context onto `test.skipIf` messages or the shared fixture.
- Deferred to first consumer: `test.skipIf` skip-reason string text — pin when a caller needs consistency across suites.
- No production or operator behavior change — rules out `v2/docs/v1-behaviors.md` update.

## Tasks

- Add `canUseUnixSockets()` to `v2/src/testing/unix-socket.ts`; remove `canCreateSockets` and `skipIfNoSockets`; update doc-comments per `v2/docs/documentation-standard.md`.
- Migrate `v2/src/ipc/ipc.test.ts`: every socket-dependent `test` uses `test.skipIf(!canUseUnixSockets(), ...)`; hook guards use `canUseUnixSockets()`; drop `skipIfNoSockets` import.
- Migrate `v2/src/daemon-start-list.test.ts` the same way.
- Migrate `v2/src/daemon.sandbox-unrunnable.test.ts` the same way.
- Update `v2/docs/test-writing.md` shared socket fixtures section: require `test.skipIf` for socket-gated v2 tests; forbid silent-return skip wrappers.

## Acceptance criteria

- [ ] `ipc.test.ts`, `daemon-start-list.test.ts`, and `daemon.sandbox-unrunnable.test.ts` contain no `skipIfNoSockets` import or usage; every socket-dependent `test` is registered via `test.skipIf(!canUseUnixSockets(), ...)`.
- [ ] `v2/src/testing/unix-socket.ts` exports `canUseUnixSockets()` and `socketProbeErrored`; it does not export `canCreateSockets` or `skipIfNoSockets`.
- [ ] `v2/docs/test-writing.md` requires `test.skipIf` for v2 socket-gated tests and forbids silent-return skip wrappers.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/test-writing.md` — socket skip policy (`test.skipIf`, no silent-return wrappers).
- `v2/src/testing/unix-socket.ts` — doc-comments on exported symbols per `v2/docs/documentation-standard.md`.
