# TUI one-hour terminal window

The monitor lists every non-terminal run plus up to fifty newest terminal runs from each daemon
`list` payload (and invocation-linked terminal siblings), so busy periods bury recent finishes and
quiet periods show stale terminal rows. Operators still reach older terminal runs via
`jarvis run list --since`.

## Decisions

- Terminal monitor rows are kept only when `finishedAtMs` is within the last **3_600_000** ms
  relative to refresh time, then capped at **20** rows; rules out mirroring the daemon
  fifty-newest retention as the live view policy.
- `finishedAtMs` on each assembled terminal `list` row is the latest attempt `completed_at` for
  that run; rules out using `created_at` as finish time for the window.
- After filtering, terminal rows in the monitor sort by `finishedAtMs` descending within the
  terminal group; active and other non-terminal rows stay ahead of terminal rows in merged daemon
  order; rules out sorting the entire table by finish time.
- The twenty-row cap bounds top-level terminal monitor rows in this subspec (one row per durable
  run); rules out pre-empting the collapse subspec's collapsed-row cap semantics.
- Omitted TUI rows are not retained for invocation-linked terminal siblings outside the window;
  rules out daemon-style invocation retention in the monitor filter.
- Non-terminal list rows (`isTerminalRunStatus` false) pass through regardless of age or
  `finishedAtMs`; rules out time-filtering active work.
- Window length and row cap are hardcoded constants in the TUI filter; rules out config or CLI
  flags in this pass.
- Default unflagged `jarvis run list` and daemon `retainListedRuns` are unchanged; the TUI applies
  the window after `mergeRunLists`; rules out aligning default CLI list output with the monitor
  window.
- Refresh-time comparison uses an injectable clock seam (`nowMs`) for tests; rules out
  unmocked `Date.now()` in the filter predicate.

## Tasks

- Add `finishedAtMs?: number` to `DaemonListRunRow` and populate it in `buildRunListRow` for
  terminal statuses from loaded attempts.
- Implement a pure `filterMonitorRunsForLiveWindow` (or equivalent) with `nowMs`, window ms, and
  terminal cap; unit-test the predicate.
- Apply the filter in `runTuiEntry` immediately after `mergeRunLists` on each refresh.
- Add `v2/src/tui/tui-monitor-terminal-window.test.ts` driving the monitor host with mixed-age
  fixtures; assert via `monitorTextLines` / rendered output per `v2/docs/test-writing.md`.
- Update `v2/docs/operator-runbook.md` § Observe and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `tui-monitor-terminal-window.test.ts` drives the monitor with terminal runs inside and
      outside the one-hour window and asserts only in-window terminal rows render, in descending
      `finishedAtMs` order, capped at twenty; it fails against baseline.
- [ ] The same or companion test asserts a non-terminal run older than one hour still appears in
      rendered monitor output.
- [ ] Coverage asserts rendered monitor text, not only `TuiMonitorState` or view-model fields.
- [ ] Tests fail when the one-hour terminal filter guard is inverted: terminal runs finished more
      than one hour before `nowMs` must appear in rendered output under inversion.
- [ ] Tests fail when the twenty-row cap guard is inverted: more than twenty in-window terminal
      runs must all appear in rendered output under inversion.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — TUI one-hour terminal window (twenty rows); older
  terminal runs via `jarvis run list --since`.
- `v2/docs/v1-behaviors.md` — TUI live terminal window vs default `run list` retention.
