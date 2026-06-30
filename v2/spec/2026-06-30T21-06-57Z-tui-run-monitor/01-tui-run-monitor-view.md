# 01 — TUI run monitor view

Interactive `jarvis tui` run monitor: list runs with live status/liveness,
select a run, read invocation-boundary outcome from daemon `wait`. Observation
only.

## Prerequisites

- Merged TUI daemon run RPCs:
  `v2/spec/2026-06-30T21-06-57Z-tui-run-monitor/00-tui-daemon-run-rpcs.md`.
- Merged TUI entry scaffold:
  `v2/spec/2026-06-30T18-32-35Z-tui-scaffold/01-tui-entry-connect.md`.

## Decisions

- Connected `jarvis tui` becomes an interactive run monitor — rules out
  connect-only ink that exits `0` immediately after liveness proof.
- Unavailable daemon path unchanged from scaffold — rules out changing exit
  code, remediation copy, or attempting run RPCs when connect fails.
- Run list fields from daemon `list` only: `runId`, `project`, `branch`,
  `status`, liveness (`isLive` → `live` / `not-live`, matching `jarvis run list`)
  — rules out log-tail or `wait` inference for list rows.
- Live list refresh via periodic `list` RPC on an injectable refresh scheduler —
  rules out manual relaunch to see updates and rules out push subscription (no
  daemon `list` stream).
- Deferred to first consumer: production poll interval — pin when refresh loop
  lands.
- Outcome panel from daemon `wait` on the selected run — rules out client-side
  log parsing or `list` polling for outcome fields.
- Selection change cancels any in-flight `wait` and starts a fresh `wait` for
  the new run — rules out showing stale outcome across selection changes.
- While `wait` is pending, the outcome panel shows an explicit pending state —
  rules out blocking the whole UI without feedback.
- Outcome panel renders `runStatus` and only present optional fields
  (`loopOutcomeKind`, `iterationsConsumed`, `resumable`) — rules out inventing
  values for omitted daemon keys.
- Read-only monitor — rules out `start`, log tail, `pause`, `resume`, `kill`, and
  stream RPCs from `jarvis tui` in this slice.
- Operator quits with `q` or Ctrl-C; exit `0` — rules out auto-exit after first
  list/outcome render.
- Deferred to first consumer: run selection UX beyond default-first-row when the
  list is non-empty — pin when view lands.
- Co-located tests inject daemon client, refresh scheduler, and view host — rules
  out live-terminal-only coverage.

## Task checklist

- Replace connected scaffold one-shot exit with an interactive ink run-monitor
  view wired through `runTuiEntry`.
- On connect: `health` + IPC `status` proof, then enter monitor loop.
- Fetch and render run list; schedule periodic `list` refresh via injectable
  scheduler.
- Track selected run; on change, issue `wait` and render outcome panel.
- Preserve unavailable-daemon feedback and exit `1`.
- Co-locate tests with fixture runs covering list refresh, selection, pending
  wait, immediate quiescent wait, and optional-field omission.
- Update operator docs per Documentation updates.

## Acceptance criteria

- [ ] When the daemon socket is unreachable, `jarvis tui` shows the scaffold unavailable-daemon feedback naming `~/.jarvis/daemon.sock` and `jarvis daemon start`, exits `1`, and does not invoke `list` or `wait`.
- [ ] When the daemon is reachable, `jarvis tui` proves IPC `health` and `status`, then stays interactive until the operator quits.
- [ ] On launch, `jarvis tui` calls daemon `list` and renders one row per run with `runId`, `project`, `branch`, `status`, and liveness (`live` / `not-live`).
- [ ] With an injectable refresh scheduler and fixture client, a later `list` response updates displayed status/liveness without relaunching `jarvis tui`.
- [ ] With fixture runs, selecting a quiescent run issues `wait` for that `runId` and the outcome panel shows `runStatus` plus only present optional fields from the daemon result.
- [ ] With a fixture client that defers `wait`, the outcome panel shows a pending state until the boundary response arrives.
- [ ] Changing the selected run while `wait` is pending abandons the prior wait and issues `wait` for the newly selected `runId`.
- [ ] `jarvis tui` does not send `start`, `pause`, `resume`, `kill`, log-stream frames, or other steering RPCs.
- [ ] Operator quit (`q` or Ctrl-C) exits `0`.
- [ ] Co-located tests cover connected monitor paths with injectable daemon client, refresh scheduler, and view-host fakes.
- [ ] `v2/docs/write-behavior.md` TUI section documents the run monitor: list fields, liveness labels, live refresh behavior, outcome panel fields, selection, quit, and unavailable-daemon contract.
- [ ] `v2/docs/v2-architecture.md` Interface cross-links `jarvis tui` run monitor to daemon `list`/`wait` (one sentence; no duplicate wire contract).
- [ ] `v2/docs/v1-behaviors.md` has a `[v2 additive]` entry for interactive `jarvis tui` run monitor under TUI/observability.
- [ ] `v2/src/cli.test.ts` coverage for `jarvis write`, `jarvis daemon`, and `jarvis run` stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) — expand TUI CLI:
  interactive run monitor, list columns, liveness labels, refresh semantics,
  outcome panel (`wait` fields), selection, quit, unavailable path.
- [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) — one-sentence
  cross-link from TUI to daemon `list`/`wait`.
- [`v2/docs/v1-behaviors.md`](../../docs/v1-behaviors.md) — `[v2 additive]`
  interactive `jarvis tui` run monitor.
