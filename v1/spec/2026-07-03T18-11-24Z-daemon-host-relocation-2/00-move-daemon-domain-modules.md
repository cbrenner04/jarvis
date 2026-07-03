# Move daemon-domain modules into v2/src/daemon/

Relocate the daemon host's flat-root modules into `v2/src/daemon/` per
`v2-architecture.md` **Source layout**, with imports fixed up. No behavior
changes.

## Decisions

- `daemon-entrypoint.ts` stays pinned at `v2/src/` root per the **Entrypoints**
  policy — rules out moving it alongside its domain siblings.
- `daemon-lifecycle.ts`'s spawn path updates from
  `resolve(import.meta.dir, "daemon-entrypoint.ts")` to
  `resolve(import.meta.dir, "../daemon-entrypoint.ts")` in the same commit as
  the move — rules out a default spawn that resolves to a stale path once
  `daemon-lifecycle.ts` relocates.
- `git mv` each module with its co-located test — rules out copy-delete moves
  that drop file history.
- Import updates are mechanical relative-path fixes only — rules out bundling
  handler or behavior changes into this move.

## Task checklist

- [ ] `git mv` into `v2/src/daemon/`: `daemon.ts`, `daemon.sandbox-unrunnable.test.ts`,
      `daemon-wire.ts`, `daemon-wire.test.ts`, `daemon-lifecycle.ts`,
      `daemon-lifecycle.test.ts`, `daemon-run-failure-capture.test.ts`,
      `daemon-start-list.test.ts`, `daemon-tail-stream.test.ts`,
      `daemon-wait-run-completion.test.ts`, `run-operator-error.ts`,
      `run-operator-error.test.ts`.
- [ ] In the moved files, fix relative imports one level deeper:
      `./execution/...` → `../execution/...`, `./ipc/...` → `../ipc/...`,
      `./persistence/...` → `../persistence/...`, `./testing/...` →
      `../testing/...`, `../../shared/...` → `../../../shared/...`.
      Imports among the moved daemon files themselves (`./daemon.ts`,
      `./daemon-wire.ts`, `./run-operator-error.ts`, `./daemon-lifecycle`)
      keep their `./` prefix since they move together.
- [ ] Update `v2/src/daemon-entrypoint.ts`'s import of `./daemon` to
      `./daemon/daemon`.
- [ ] Update `v2/src/daemon-lifecycle.ts`'s entrypoint spawn path per the
      **Decisions** entry above.
- [ ] Update root-level importers of the moved modules to the new path:
      `v2/src/cli.ts`, `v2/src/tui-daemon-client.ts`, `v2/src/tui-daemon-client.test.ts`,
      `v2/src/tui-log-tail-client.test.ts`, `v2/src/tui-monitor-types.ts`,
      `v2/src/tui-entry.tsx`, `v2/src/tui-entry.test.tsx` (imports of `./daemon.ts`,
      `./daemon-wire.ts`, `./daemon-lifecycle.ts` → `./daemon/daemon.ts`,
      `./daemon/daemon-wire.ts`, `./daemon/daemon-lifecycle.ts`).
- [ ] Update `test/test-slices.test.ts`'s hardcoded integration-file literal
      `v2/src/daemon.sandbox-unrunnable.test.ts` to
      `v2/src/daemon/daemon.sandbox-unrunnable.test.ts`.

## Acceptance criteria

- [ ] `bun run typecheck` passes with no daemon-domain import errors.
- [ ] `daemon-lifecycle.test.ts` and `daemon.sandbox-unrunnable.test.ts` stay
      green (spawn/lifecycle behavior unchanged by the move).
- [ ] `daemon-wire.test.ts`, `daemon-run-failure-capture.test.ts`,
      `daemon-start-list.test.ts`, `daemon-tail-stream.test.ts`,
      `daemon-wait-run-completion.test.ts`, and `run-operator-error.test.ts`
      stay green.
- [ ] `test/test-slices.test.ts` stays green (integration-file enumeration
      matches the relocated path).
- [ ] No `v2/src/` module outside `v2/src/daemon/` and `v2/src/daemon-entrypoint.ts`
      imports execution, persistence, `ipc/`, or `shared/` on the daemon
      host's behalf (`git mv` moved every non-entrypoint daemon module).

## Documentation updates

- `v2/docs/daemon-host.md`: fix `v2/src/daemon-lifecycle.ts` and
  `v2/src/daemon.ts` citations to `v2/src/daemon/daemon-lifecycle.ts` and
  `v2/src/daemon/daemon.ts`.
- `v2/docs/test-writing.md`: fix the two `../src/daemon-*.test.ts` links to
  `../src/daemon/daemon-*.test.ts`.
- `v2/docs/v1-behaviors.md`: no `Sources:` line currently cites a daemon
  module path directly (existing citations are `v2/src/cli.ts`); confirm this
  and make no change unless one is found.
