# Track consecutive iteration-timeouts and surface a split-it blocker

Per-iteration wall-clock timeout (exit 8, `exitReason` `iteration-timeout` /
`watchdog-iteration-timeout`, `v1/src/modes/patch/iteration.ts:914-939`) is
always terminal — no agent cascade, so each timeout ends the whole `jarvis
run` process. Nothing today attributes that timeout to the active subspec or
remembers it across the next `jarvis run` invocation, so an oversized subspec
just re-walls every run with no signal that it needs splitting.

## Decisions

- Track only per-iteration wall-clock timeouts (`iteration-timeout`,
  `watchdog-iteration-timeout`), not idle-watchdog or global run-timeout exits
  — those signal agent stall or session-length limits, not subspec size.
- Persist the counter via the existing telemetry JSONL (`cfg.telemetryPath`)
  instead of new state storage — already durable across process restarts;
  telemetry disabled (`telemetryPath: null`) means tracking is unavailable,
  same as other telemetry-dependent reporting.
- Add `active_subspec_path` to the iteration-timeout terminal telemetry
  record and mark it `record_role: "run_terminal"` — rules out inferring
  subspec identity from row position alone; rows are disambiguated by path,
  so two projects/repos sharing an identical subspec path in a shared
  telemetry log is the only residual conflation risk.
- At run start, count trailing consecutive `run_terminal` timeout rows
  attributed to the resolved active subspec; the first non-matching subspec
  or non-timeout terminal row resets the count to 0 — rules out counting
  across a subspec split, resume, or after any run that made progress.
- Bound is a hardcoded constant (`CONSECUTIVE_ITERATION_TIMEOUT_BOUND = 3`),
  matching the existing `CONSECUTIVE_RED_FIXUP_BOUND` precedent
  (`completion-pipeline.ts:476`) — rules out adding config schema for a
  single-operator repo.
- On reaching the bound, the harness appends a `## Blocker` to the active
  subspec (harness-authored, precedented by plan mode's
  `appendBoundaryBlocker`) instead of exiting 8 silently again — reuses the
  existing blocker-halts-next-run check (`iteration.ts:556-576`) rather than
  inventing a new stop path. The blocker text explicitly recommends splitting
  the subspec (not just a timeout-count note) — the intent asks for a clear
  "split it" signal, not a bare fact. The run that hits the bound and appends
  the blocker still exits 8 itself, same as every other iteration-timeout
  exit; the blocker only changes what the *next* run does.
- If the active subspec already carries a `## Blocker`, skip appending
  (idempotent, no duplicate/overwrite). Known limitation: if that existing
  blocker is unrelated (e.g. an ambiguity halt), reaching the bound is
  silently suppressed and the operator sees only the unrelated blocker, not
  the split signal — accepted tradeoff, not handled by this subspec.

## Out of scope

- Automatically splitting the subspec.
- Checkpoint-commit and prompt-conditioning behaviors (separate intents).

## Acceptance criteria

- [x] A patch-mode iteration-timeout terminal telemetry row carries
      `active_subspec_path` and `record_role: "run_terminal"`.
- [x] A run whose active subspec has 2 prior consecutive iteration-timeout
      terminal rows and now times out again appends a `## Blocker` to the
      active subspec that explicitly recommends splitting the subspec (not
      just a timeout-count note), and this run still exits 8.
- [x] A subspec with only 1 prior timeout (below the bound) exits 8 without a
      blocker on the next timeout (no false positive before the bound).
- [x] A prior timeout on a different subspec, or any non-timeout
      `run_terminal` row for the same subspec, does not count toward the
      streak.
- [x] If the active subspec already has a `## Blocker`, reaching the bound
      does not duplicate or overwrite it.
- [x] With telemetry disabled (`telemetryPath: null`), a run whose active
      subspec would otherwise have hit the bound exits 8 as before, with no
      blocker appended and no error/crash.
- [x] `v1/test/run.test.ts` gains coverage for the above alongside the
      existing "iteration timeout causes exit code 8" test (`run.test.ts:6478`).

## Documentation updates

- `v1/docs/run-loop.md` § "Stop conditions and exit codes": document the
  consecutive-iteration-timeout counter and the split-it blocker it produces
  at the bound.
- `v1/docs/operator-runbook.md`: note the new blocker signal and that the
  operator should split the subspec in response.
- `v2/docs/v1-behaviors.md`: record the repeated-timeout detection behavior
  (existing exit-8 timeout entry is the template to extend).
