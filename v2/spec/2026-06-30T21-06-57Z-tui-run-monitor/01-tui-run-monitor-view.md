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
- After `health` + IPC `status` proof, enter run monitor only — rules out
  indefinite dual scaffold proof chrome alongside the monitor.
- One open `TuiDaemonClient` from post-connect proof until operator quit;
  `close()` on exit — rules out scaffold one-shot `finally` close after liveness
  proof.
- Unavailable daemon path unchanged from scaffold — rules out changing exit
  code, remediation copy, or attempting run RPCs when connect fails.
- Run list fields from daemon `list` only: `runId`, `project`, `branch`,
  `status`, liveness (`isLive` → `live` / `not-live`, matching `jarvis run list`)
  — rules out log-tail or `wait` inference for list rows.
- List row `status` is poll-time from `list`; outcome panel `runStatus` is
  resolve-time from `wait` — rules out cross-inferring outcome from list polls.
- Outcome panel shows an invocation-boundary snapshot from `wait`, not durable
  terminal-only semantics — rules out treating outcome as "terminal only."
- Non-empty list on entry: select first row (daemon `list` newest-first /
  `created_at DESC`) and issue `wait` — rules out no initial selection or `wait`.
- Empty list on entry: no selection, no `wait`, explicit empty state — rules out
  implicit undefined behavior.
- Live list refresh via periodic `list` RPC on an injectable refresh scheduler —
  rules out manual relaunch to see updates and rules out push subscription (no
  daemon `list` stream).
- List refresh preserves selection by `runId`; if the selected run vanishes,
  clear selection and abandon any pending `wait` — rules out stale selection on
  removed rows.
- Deferred to first consumer: production poll interval — pin when refresh loop
  lands.
- Deferred to first consumer: mid-session `list`/`wait` transport and RPC error UX
  (sticky last-good list vs inline error) — pin when refresh loop lands.
- Outcome panel from daemon `wait` on the selected run — rules out client-side
  log parsing or `list` polling for outcome fields.
- Selection change abandons prior `wait` client-side only (no server cancel, no
  disconnect) and starts a fresh `wait` for the new run — rules out showing stale
  outcome across selection changes.
- Late responses from abandoned waits are ignored (request `id` and/or selected
  `runId`) — rules out stale outcome after selection change.
- While `wait` is pending, the outcome panel shows an explicit pending state —
  rules out blocking the whole UI without feedback.
- Outcome panel renders `runStatus` and only present optional fields
  (`loopOutcomeKind`, `iterationsConsumed`, `resumable`) — rules out inventing
  values for omitted daemon keys.
- Read-only monitor — rules out `start`, log tail, `pause`, `resume`, `kill`, and
  stream RPCs from `jarvis tui` in this slice.
- Operator quits with `q` or Ctrl-C; exit `0` — rules out auto-exit after first
  list/outcome render.
- Selection-change ACs verified through injectable view-host seam until operator
  row-navigation keybindings land — rules out unpinned production navigation
  blocking AC verification.
- Deferred to first consumer: production row-navigation keybindings — pin when
  view lands.
- Co-located tests inject daemon client, refresh scheduler, and view host — rules
  out live-terminal-only coverage.

## Task checklist

- Replace connected scaffold one-shot exit with an interactive ink run-monitor
  view wired through `runTuiEntry`.
- On connect: `health` + IPC `status` proof, then enter monitor loop on the same
  open client.
- Fetch and render run list; schedule periodic `list` refresh via injectable
  scheduler; pin initial/empty selection behavior.
- Track selected run by `runId` across refresh; on change, abandon prior `wait`,
  issue fresh `wait`, ignore late abandoned replies.
- `close()` client on operator quit.
- Preserve unavailable-daemon feedback and exit `1`.
- Co-locate tests with fixture runs covering list refresh, selection (view-host
  seam), pending wait, late abandoned wait, immediate quiescent wait, optional-field
  omission, empty list, and selection cleared on row removal.
- Update operator docs per Documentation updates.

## Acceptance criteria

- [x] When the daemon socket is unreachable, `jarvis tui` shows the scaffold unavailable-daemon feedback naming `~/.jarvis/daemon.sock` and `jarvis daemon start`, exits `1`, and does not invoke `list` or `wait`.
- [x] When the daemon is reachable, `jarvis tui` proves IPC `health` and `status`, then enters the run monitor on the same open client and stays interactive until the operator quits.
- [x] On launch with a non-empty list, `jarvis tui` calls daemon `list`, selects the first row (newest-first), issues `wait` for that `runId`, and renders one row per run with `runId`, `project`, `branch`, `status`, and liveness (`live` / `not-live`).
- [x] On launch with an empty list, `jarvis tui` shows an explicit empty state, does not select a run, and does not invoke `wait`.
- [x] With an injectable refresh scheduler and fixture client, a later `list` response updates displayed status/liveness without relaunching `jarvis tui`.
- [x] With an injectable refresh scheduler and fixture client, when a refreshed `list` omits the selected `runId`, selection clears and any pending `wait` is abandoned.
- [x] With fixture runs and injectable view-host seam, selecting a quiescent run issues `wait` for that `runId` and the outcome panel shows `runStatus` plus only present optional fields from the daemon result.
- [x] With a fixture client that defers `wait`, the outcome panel shows a pending state until the boundary response arrives.
- [x] With injectable view-host seam, changing the selected run while `wait` is pending abandons the prior wait and issues `wait` for the newly selected `runId`.
- [x] With injectable view-host seam and a fixture that emits a late reply for an abandoned `wait`, the outcome panel stays on the newly selected run and does not show the stale result.
- [x] `jarvis tui` does not send `start`, `pause`, `resume`, `kill`, log-stream frames, or other steering RPCs.
- [x] Operator quit (`q` or Ctrl-C) closes the client and exits `0`.
- [x] Co-located tests cover connected monitor paths with injectable daemon client, refresh scheduler, and view-host fakes.
- [x] `v2/src/tui-entry.test.tsx` stays green (updated for interactive run monitor).
- [x] `v2/docs/write-behavior.md` TUI section documents the run monitor: list fields vs outcome `runStatus`, liveness labels, live refresh behavior, outcome panel (`wait` fields), selection, quit, and unavailable-daemon contract.
- [x] `v2/docs/write-behavior.md` Verification section updates the `tui-entry.test.tsx` bullet for interactive run-monitor scope.
- [x] `v2/docs/v2-architecture.md` Interface cross-links `jarvis tui` run monitor to daemon `list`/`wait` (one sentence; no duplicate wire contract).
- [x] `v2/docs/v1-behaviors.md` has a `[v2 additive]` entry for interactive `jarvis tui` run monitor under TUI/observability.
- [x] `v2/src/cli.test.ts` coverage for `jarvis write`, `jarvis daemon`, and `jarvis run` stays green.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) — expand TUI CLI:
  interactive run monitor, list columns (`status` at poll time), liveness labels,
  refresh semantics, outcome panel (`runStatus` and optional `wait` fields at
  resolve time; no cross-inference from list), selection, quit, unavailable path;
  update Verification `tui-entry.test.tsx` bullet.
- [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) — one-sentence
  cross-link from TUI to daemon `list`/`wait`.
- [`v2/docs/v1-behaviors.md`](../../docs/v1-behaviors.md) — `[v2 additive]`
  interactive `jarvis tui` run monitor.
