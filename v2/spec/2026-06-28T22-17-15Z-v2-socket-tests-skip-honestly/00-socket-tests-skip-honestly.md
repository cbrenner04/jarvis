# 00 - Socket tests skip honestly

Migrate v2 socket-backed tests from silent-return `skipIfNoSockets` wrappers
to Bun `test.skipIf` so unavailable Unix sockets report skipped, not pass.

## Prerequisites

- `v2/src/testing/unix-socket.ts` exports a shared settled Unix-socket
  availability probe (`canCreateSockets` role today).

## Decisions

- Gate socket-dependent tests with `test.skipIf(!canUseUnixSockets(), ...)` — rules out `skipIfNoSockets` early returns that report pass.
- `test.skipIf` gates at test registration on the post-settle probe value — rules out preserving invocation-time `skipIfNoSockets` gating; accepts late-`listening` false-skip tradeoff.
- Export `canUseUnixSockets(): boolean` as the canonical probe accessor; remove `canCreateSockets` and `skipIfNoSockets` — rules out dual naming or keeping the silent-return wrapper.
- `canUseUnixSockets()` reads availability at call time; `test.skipIf` captures it at registration; post-settle false→true does not un-skip registered tests; hook guards may observe a later flip — rules out implying invocation-time skip parity via the accessor alone.
- Touch only `ipc.test.ts`, `daemon-start-list.test.ts`, and `daemon.sandbox-unrunnable.test.ts` plus the shared fixture — rules out v1/shared sandbox-unrunnable migration or opportunistic v2 test edits.
- Keep file-local `socketProbeErrored` stderr emission unchanged — rules out moving operator skip context onto `test.skipIf` messages or the shared fixture.
- Deferred to first consumer: `test.skipIf` skip-reason string text — pin when a caller needs consistency across suites.
- No production or operator behavior change — rules out `v2/docs/v1-behaviors.md` update.

## Tasks

- Add `canUseUnixSockets()` to `v2/src/testing/unix-socket.ts`; remove `canCreateSockets` and `skipIfNoSockets`; doc-comment exported symbols per `v2/docs/documentation-standard.md`, including read-semantics for `canUseUnixSockets()`.
- Migrate `v2/src/ipc/ipc.test.ts`: every socket-dependent `test` uses `test.skipIf(!canUseUnixSockets(), ...)`; hook guards use `canUseUnixSockets()`; drop `skipIfNoSockets` and `canCreateSockets` imports.
- Migrate `v2/src/daemon-start-list.test.ts` the same way.
- Migrate `v2/src/daemon.sandbox-unrunnable.test.ts` the same way.
- Update `v2/docs/test-writing.md` shared socket fixtures section: require `test.skipIf` and forbid silent-return skip wrappers; preserve hook-guard and `socketProbeErrored` stderr guidance.

## Acceptance criteria

- [ ] When Unix sockets are unavailable, socket-dependent tests in `ipc.test.ts`, `daemon-start-list.test.ts`, and `daemon.sandbox-unrunnable.test.ts` report skipped, not pass.
- [ ] `ipc.test.ts`, `daemon-start-list.test.ts`, and `daemon.sandbox-unrunnable.test.ts` contain no `skipIfNoSockets` or `canCreateSockets` import or usage; every socket-dependent `test` is registered via `test.skipIf(!canUseUnixSockets(), ...)`; hook guards use `canUseUnixSockets()`.
- [ ] `v2/src/testing/unix-socket.ts` exports `canUseUnixSockets()` and `socketProbeErrored`; it does not export `canCreateSockets` or `skipIfNoSockets`.
- [ ] `canUseUnixSockets` and `socketProbeErrored` doc-comments in `v2/src/testing/unix-socket.ts` meet `v2/docs/documentation-standard.md`; `canUseUnixSockets` states read-at-call-time semantics and registration vs hook-guard behavior.
- [ ] File-local stderr gated on `socketProbeErrored` in `ipc.test.ts` and `daemon.sandbox-unrunnable.test.ts` stays unchanged; `daemon-start-list.test.ts` stays silent on skip.
- [ ] `v2/docs/test-writing.md` requires `test.skipIf` for v2 socket-gated tests, forbids silent-return skip wrappers, and preserves hook-guard and probe-error stderr guidance.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/test-writing.md` — socket skip policy (`test.skipIf`, no silent-return wrappers); preserve hook-guard and `socketProbeErrored` stderr guidance.
- `v2/src/testing/unix-socket.ts` — doc-comments on exported symbols per `v2/docs/documentation-standard.md`, including `canUseUnixSockets` read semantics.
