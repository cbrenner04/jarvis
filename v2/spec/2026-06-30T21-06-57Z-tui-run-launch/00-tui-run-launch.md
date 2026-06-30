# 00 — TUI run launch

Operator starts a detached write-loop run from `jarvis tui`: collect the same
launch inputs as `jarvis run start`, send one daemon IPC `start`, show the
returned run ID or admission-guard errors. Observation and steering stay out of
scope.

## Prerequisites

- Merged TUI scaffold:
  `v2/spec/2026-06-30T18-32-35Z-tui-scaffold/`.
- Daemon `start` RPC contract:
  `v2/docs/daemon-host.md` and
  `v2/spec/completed/2026-06-28T00-42-48Z-daemon-run-control-api/01-daemon-start-list.md`.

## Decisions

- Launch maps to daemon IPC `start` only — rules out foreground `executeWriteLoop` from the TUI.
- Required launch fields mirror `jarvis run start` / `jarvis write` (`--project-root`, `--project`, `--branch`, `--base`, `--spec`, `--artifact`, optional `--agents`, `--max-iterations`) — rules out a parallel TUI input schema.
- `WriteLoopInput` payload matches `jarvis run start` mapping (`stepRules`, bindings from agents CSV, worktree shape, optional `maxIterations`) — rules out hand-rolled partial `start` params.
- Extend `TuiDaemonClient` with `start` on the existing connection — rules out ad-hoc `connectIpcClient` / RPC helpers in the launch layer and rules out a second connect-only client type.
- Admission guards (`run_in_progress`, `worktree_claimed`) pass through as `TuiDaemonRpcError` and render operator-visibly as `<code>: <message>` — rules out local reimplementation of daemon start guards.
- Unavailable daemon preserves shipped scaffold contract (socket name, `jarvis daemon start` remediation, exit `1`, no run-control RPCs) — rules out changing connect-failure semantics in this slice.
- Launch slice RPC surface: connect scaffolding (`health`, `status`) plus one `start` — rules out `list`, `wait`, log streams, `pause`, `resume`, and `kill`.
- Foreground `jarvis write` and `jarvis run` hosts stay — rules out TUI-only or daemon-only entry replacing them.
- Co-located tests inject daemon client and view host — rules out live-terminal-only automated coverage.
- Deferred to first consumer: form layout, field defaults, validation UX copy, operator cancel/abort path — pin in refine.
- Deferred to first consumer: post-launch session behavior after showing run ID (exit vs persist for monitor) — pin in monitor slice or refine.

## Task checklist

- Extend `v2/src/tui-daemon-client.ts` with `start(input: WriteLoopInput)` returning `{ runId: string }`; correlated daemon `error` frames reject as `TuiDaemonRpcError`.
- Add co-located client tests for successful `start` and `run_in_progress` / `worktree_claimed` pass-through with injectable IPC transport.
- Evolve `jarvis tui` from connect-only scaffold to connect → collect launch fields → `start` → operator feedback.
- Build `WriteLoopInput` through the same field contract as `jarvis run start`; share extraction with CLI when practical, without changing foreground `jarvis write` behavior.
- Success path: operator-visible feedback includes the returned run ID; exit `0`.
- Guard path: show `<code>: <message>`; exit `1`; do not call `executeWriteLoop` locally.
- Unavailable-daemon path: preserve scaffold feedback and exit `1`.
- Do not invoke `list`, `wait`, log streams, `pause`, `resume`, or `kill`.
- Co-locate launch-flow tests with injectable daemon client and view-host fakes (success, both guards, unavailable daemon).
- Update durable operator docs per Documentation updates.

## Acceptance criteria

- [ ] `TuiDaemonClient.start` sends one correlated IPC `start` request carrying `WriteLoopInput` and returns `{ runId }` on success.
- [ ] `TuiDaemonClient.start` rejects `run_in_progress` and `worktree_claimed` daemon errors as `TuiDaemonRpcError` without local guard logic.
- [ ] When the daemon is reachable, `jarvis tui` collects the same required launch fields as `jarvis run start`, sends one `start` with matching `WriteLoopInput`, and does not call `executeWriteLoop` locally.
- [ ] On successful `start`, operator-visible feedback includes the returned run ID and `jarvis tui` exits `0`.
- [ ] On daemon `run_in_progress` or `worktree_claimed`, operator-visible feedback shows `<code>: <message>`, `jarvis tui` exits `1`, and no local guard logic runs.
- [ ] When the daemon socket is unreachable, `jarvis tui` preserves scaffold unavailable-daemon feedback (names `~/.jarvis/daemon.sock`, mentions `jarvis daemon start`), exits `1`, and does not invoke run-control RPCs.
- [ ] `jarvis tui` does not invoke `list`, `wait`, log streams, `pause`, `resume`, or `kill`.
- [ ] Co-located tests cover `TuiDaemonClient.start` success and both admission guards with injectable IPC fakes.
- [ ] Co-located tests cover launch-flow success, both admission guards, and unavailable daemon with injectable daemon client and view-host fakes.
- [ ] `v2/src/cli.test.ts` coverage for `jarvis write`, `jarvis daemon`, and `jarvis run` stays green.
- [ ] `v2/docs/write-behavior.md` TUI section documents launch inputs (same contract as `jarvis run start`), successful run ID display, admission-guard `<code>: <message>` display, and exit codes (`0` success, `1` guard or unavailable).
- [ ] `v2/docs/v2-architecture.md` shipped TUI subsection records run launch over IPC `start`; monitor and steer remain sibling work.

## Documentation updates

- [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) — extend TUI CLI table/section with launch field contract, run ID success output, guard errors, exit codes.
- [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) — update shipped TUI scaffold bullet to include launch; cross-link `write-behavior.md#tui-cli`.
