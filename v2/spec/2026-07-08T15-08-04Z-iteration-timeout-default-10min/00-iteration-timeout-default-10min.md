# Lower default iterationTimeoutMs to 10 minutes

`DEFAULT_CONFIG.iterationTimeoutMs` (`v1/src/config.ts:168`) is `30 * 60_000`.
A stalled patch/review/shrink/prompt iteration with no operator override runs
30 minutes before the wall-clock watchdog aborts it. Lower the default to
`10 * 60_000` (600,000 ms); operator override via config is unaffected.

## Decisions

- `DEFAULT_CONFIG.iterationTimeoutMs` becomes `10 * 60_000` (600,000) — rules
  out leaving the shipped default at 30 minutes while only updating docs.
- Watchdog abort reason names (`iteration-timeout`, `actuator-timeout`,
  `shrink-timeout`) and escalation/cascade behavior are unchanged; only the
  default duration moves.
- Config-file override (`iterationTimeoutMs` in `~/.jarvis/config.json` or
  project config) continues to take precedence over the default.
- Plan-mode iterations (`v1/src/modes/plan/run.ts`) read the same
  `rawCfg.iterationTimeoutMs` knob as patch/review/shrink/prompt — the lower
  default is in-scope for plan mode too, not exempted.

## Documentation updates

- `v1/docs/config.md`: update the `iterationTimeoutMs` field comment and
  example JSON value from 1,800,000/30 minutes to 600,000/10 minutes.
- `v1/docs/run-loop.md`: update "default 30 minutes" reference for
  `iterationTimeoutMs` to 10 minutes.
- `v1/docs/quota-signals.md`: check for and update any stale 30-minute
  reference tied to `iterationTimeoutMs`.
- `v1/docs/specless-prompt.md`: update the "default 30 minutes" reference
  (the `iterationTimeoutMs` line) to 10 minutes.
- `README.md`: update the `"iterationTimeoutMs": 1800000` example value and
  adjacent "30 minutes" prose to 600000/10 minutes. (The
  `JARVIS_READY_TIMEOUT_MS=1800000` example is a distinct env var — out of
  scope, no change.)
- `v1/docs/operator-runbook.md`: record the 10-minute default as the
  hard-fail-fast operator policy (an unconfigured operation running past 10
  minutes is a defect to fix, not tolerated).
- `v2/docs/v1-behaviors.md`: record the new `iterationTimeoutMs` default
  (600,000 / 10 min, was 1,800,000 / 30 min) — this changes existing
  functionality, so the v1-parity baseline must reflect it.

## Acceptance criteria

- [x] `DEFAULT_CONFIG.iterationTimeoutMs` in `v1/src/config.ts` equals `600_000`.
- [x] Tests asserting the *default* value (e.g. `v1/test/config.test.ts`
      `DEFAULT_CONFIG`/`loadConfig()` expectations) are updated to 600,000 and
      stay green. Tests that merely pass `30 * 60_000` as an unrelated,
      explicit fixture/override value (not asserting the default) are left
      unchanged.
- [x] A patch iteration, a review iteration, a shrink iteration, and a
      prompt-mode iteration each abort via their watchdog at the new default
      when no config override is set — verified by the existing per-mode
      watchdog-timeout tests (`v1/test/run.test.ts`,
      `v1/test/modes/patch/review.test.ts`, `v1/test/modes/patch/shrink.test.ts`,
      `v1/test/modes/prompt/run.test.ts`) passing against
      `DEFAULT_CONFIG.iterationTimeoutMs` rather than a hardcoded 30-minute
      value.
- [x] No remaining "30 min" / "1,800,000" / "1_800_000" reference to
      `iterationTimeoutMs` in `v1/docs/config.md`, `v1/docs/run-loop.md`,
      `v1/docs/quota-signals.md`, `v1/docs/specless-prompt.md`, or `README.md`.
- [x] `v1/docs/operator-runbook.md` documents the 10-minute default as
      hard-fail-fast operator policy.
- [x] `v2/docs/v1-behaviors.md` reflects the new 600,000 ms default.
