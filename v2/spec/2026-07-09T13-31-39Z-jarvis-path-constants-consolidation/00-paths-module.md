# Add paths module and migrate call sites

## Problem

`~/.jarvis` path constants are redefined at each use site instead of sourced
from one place: `daemon.sock` in `v2/src/cli.ts`, `v2/src/tui/tui-log-tail-client.ts`,
and `v2/src/tui/tui-daemon-client.ts`; the matching display string
`TUI_DAEMON_SOCKET_DISPLAY` in `v2/src/tui/tui-daemon-errors.ts`; plus
`daemon.pid` and `config.json` (`cli.ts`, `config/machine-config-loader.ts`).
A path typo in one site would silently diverge from the others.

## Decisions

- New module `v2/src/paths.ts` exports `DAEMON_SOCKET_PATH`, `DAEMON_PID_PATH`,
  `MACHINE_CONFIG_PATH`, and `DAEMON_SOCKET_DISPLAY` — rules out a partial
  dedup that leaves any of these redefined locally.
- Constants, not functions — `homedir()` is stable for the process lifetime,
  so no call-site behavior changes (rules out reintroducing per-call
  `homedir()` indirection with no observable benefit).
- `machine-config-loader.ts`'s three exported functions keep their
  `configPath: string = ...` default-parameter signature; the default value
  becomes `MACHINE_CONFIG_PATH` instead of an inline `join(homedir(), ...)`
  — callers and existing tests that pass an explicit `configPath` are
  unaffected.
- Out of scope: `daemon/daemon.ts`'s `state/logs.jsonl`, `execution/workflow-runner.ts`'s
  `telemetry.jsonl`, `execution/external-worktree.ts`'s worktree/lock paths, and
  `persistence/state-store.ts`'s `state/v2.sqlite` — the intent scopes this
  consolidation to `daemon.sock`, `daemon.pid`, `config.json`, and the socket
  display string only.

## Task Checklist

- [ ] Create `v2/src/paths.ts` exporting `DAEMON_SOCKET_PATH`, `DAEMON_PID_PATH`,
      `MACHINE_CONFIG_PATH` (each `join(homedir(), ".jarvis", ...)`) and
      `DAEMON_SOCKET_DISPLAY` (`"~/.jarvis/daemon.sock"`).
- [ ] `v2/src/cli.ts`: import `DAEMON_SOCKET_PATH`, `DAEMON_PID_PATH`,
      `MACHINE_CONFIG_PATH` from `./paths.ts`; drop the local
      `DEFAULT_SOCKET_PATH` / `DEFAULT_PID_PATH` / `DEFAULT_MACHINE_CONFIG_PATH`
      definitions and their now-unused `homedir`/`join` usage if no longer
      needed elsewhere in the file.
- [ ] `v2/src/tui/tui-log-tail-client.ts`: import `DAEMON_SOCKET_PATH` from
      `../paths.ts`; drop the local `DEFAULT_SOCKET_PATH` definition and
      unused `homedir` import if no longer needed elsewhere in the file.
- [ ] `v2/src/tui/tui-daemon-client.ts`: same migration as
      `tui-log-tail-client.ts`.
- [ ] `v2/src/tui/tui-daemon-errors.ts`: import `DAEMON_SOCKET_DISPLAY` from
      `../paths.ts` and re-export it as `TUI_DAEMON_SOCKET_DISPLAY` (existing
      import sites reference this name; renaming them is out of scope).
- [ ] `v2/src/config/machine-config-loader.ts`: import `MACHINE_CONFIG_PATH`
      from `../paths.ts`; use it as the default value for the `configPath`
      parameter in `readMachineConfigDocument`, `loadMachineConfig`, and
      `resolveMachineProfile`; drop the local inline `join(homedir(), ...)`
      defaults and unused `homedir`/`join` imports if no longer needed
      elsewhere in the file.
- [ ] Create `v2/src/paths.test.ts` asserting the exact literal values of all
      four exported constants (`DAEMON_SOCKET_PATH`, `DAEMON_PID_PATH`,
      `MACHINE_CONFIG_PATH`, `DAEMON_SOCKET_DISPLAY`).

## Acceptance criteria

- [ ] `v2/src/cli.ts`, `v2/src/tui/tui-log-tail-client.ts`,
      `v2/src/tui/tui-daemon-client.ts`, `v2/src/tui/tui-daemon-errors.ts`,
      and `v2/src/config/machine-config-loader.ts` each import their
      `~/.jarvis` path constant(s) from `v2/src/paths.ts` instead of
      redefining them.
- [ ] `cli.test.ts`, `tui-log-tail-client.test.ts`, `tui-daemon-client.test.ts`,
      and `machine-config-loader.test.ts` stay green (behavior unchanged by
      the extraction).
- [ ] `paths.test.ts` asserts the literal values of `DAEMON_SOCKET_PATH`,
      `DAEMON_PID_PATH`, `MACHINE_CONFIG_PATH`, and `DAEMON_SOCKET_DISPLAY`.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — internal source-organization change; no operator-facing or
documented behavior changes.
