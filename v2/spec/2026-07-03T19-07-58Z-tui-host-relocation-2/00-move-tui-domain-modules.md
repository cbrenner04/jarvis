# Move TUI-domain modules into v2/src/tui/

Relocate the TUI host's flat-root modules into `v2/src/tui/` per
`v2-architecture.md` **Source layout**, with imports fixed up. No behavior
changes.

## Decisions

- `git mv` each module with its co-located test — rules out copy-delete moves
  that drop file history.
- Import updates are mechanical relative-path fixes only — rules out bundling
  Ink/renderer or behavior changes into this move.

## Task checklist

- [ ] `git mv` into `v2/src/tui/`: `tui-daemon-client.ts`,
      `tui-daemon-client.test.ts`, `tui-daemon-errors.ts`,
      `tui-daemon-rpc-transport.ts`, `tui-entry.tsx`, `tui-entry.test.tsx`,
      `tui-field-collector.tsx`, `tui-ink-feedback.tsx`,
      `tui-ink-log-follow.tsx`, `tui-ink-monitor.tsx`, `tui-ink-runtime.ts`,
      `tui-log-follow-entry.tsx`, `tui-log-follow-entry.test.tsx`,
      `tui-log-follow-lines.ts`, `tui-log-follow-types.ts`,
      `tui-log-tail-client.ts`, `tui-log-tail-client.test.ts`,
      `tui-monitor-lines.ts`, `tui-monitor-types.ts`.
- [ ] In the moved files, fix relative imports one level deeper:
      `./daemon/...` → `../daemon/...`, `./execution/...` →
      `../execution/...`, `./ipc/...` → `../ipc/...`, `./persistence/...` →
      `../persistence/...`, `./testing/...` → `../testing/...`. Imports among
      the moved TUI files themselves (e.g. `./tui-daemon-errors.ts`,
      `./tui-ink-feedback.tsx`, `./tui-monitor-types.ts`) keep their `./`
      prefix since they move together.
- [ ] Update `v2/src/cli.ts`'s imports of `./tui-entry.tsx`,
      `./tui-log-follow-entry.tsx`, `./tui-log-follow-types.ts`,
      `./tui-monitor-types.ts` to `./tui/tui-entry.tsx`,
      `./tui/tui-log-follow-entry.tsx`, `./tui/tui-log-follow-types.ts`,
      `./tui/tui-monitor-types.ts`.

## Acceptance criteria

- [ ] `bun run typecheck` passes with no TUI-domain import errors.
- [ ] `tui-entry.test.tsx` stays green (TUI run-monitor flow unchanged by the
      move).
- [ ] `tui-log-follow-entry.test.tsx` stays green (TUI log-follow flow
      unchanged by the move).
- [ ] `tui-daemon-client.test.ts` and `tui-log-tail-client.test.ts` stay green.
- [ ] `bun test v2/src/cli.test.ts` stays green (`jarvis tui` and `jarvis tui
      log <run-id>` dispatch unchanged).
- [ ] No new layering violation is introduced by the relocation: every moved
      module's imports resolve to execution, persistence, daemon, `ipc/`, or
      `shared/` paths only, per the Import direction matrix — never CLI host.
- [ ] Imports among moved TUI files themselves (e.g. `tui-daemon-errors.ts`,
      `tui-ink-feedback.tsx`, `tui-monitor-types.ts`) retain their `./` prefix,
      unchanged by the move.

## Documentation updates

- `v2/docs/write-behavior.md`: fix `v2/src/tui-entry.test.tsx` and
  `v2/src/tui-log-follow-entry.test.tsx` citations to
  `v2/src/tui/tui-entry.test.tsx` and
  `v2/src/tui/tui-log-follow-entry.test.tsx`.
- `v2/docs/v1-behaviors.md`: fix both `Sources:` lines citing
  `v2/src/tui-entry.tsx` to `v2/src/tui/tui-entry.tsx`.
- `v2-architecture.md`: update the Domain map's TUI host row to the
  `Relocated from flat root: <list>` convention already used for the
  Execution/Persistence/Daemon rows.
