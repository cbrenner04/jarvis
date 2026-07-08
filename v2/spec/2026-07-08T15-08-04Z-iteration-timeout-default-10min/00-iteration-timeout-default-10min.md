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

## Documentation updates

- `v1/docs/config.md`: update the `iterationTimeoutMs` field comment and
  example JSON value from 1,800,000/30 minutes to 600,000/10 minutes.
- `v1/docs/run-loop.md`: update "default 30 minutes" reference for
  `iterationTimeoutMs` to 10 minutes.
- `v1/docs/quota-signals.md`: check for and update any stale 30-minute
  reference tied to `iterationTimeoutMs`.
- `v1/docs/operator-runbook.md`: record the 10-minute default as the
  hard-fail-fast operator policy (an unconfigured operation running past 10
  minutes is a defect to fix, not tolerated).

## Acceptance criteria

- [ ] `DEFAULT_CONFIG.iterationTimeoutMs` in `v1/src/config.ts` equals `600_000`.
- [ ] `v1/test/config.test.ts` (and any other test asserting the 30-minute
      default) is updated and stays green with the new 600,000 ms default.
- [ ] No remaining "30 min" / "1,800,000" / "1_800_000" reference to
      `iterationTimeoutMs` in `v1/docs/config.md`, `v1/docs/run-loop.md`, or
      `v1/docs/quota-signals.md`.
- [ ] `v1/docs/operator-runbook.md` documents the 10-minute default as
      hard-fail-fast operator policy.
