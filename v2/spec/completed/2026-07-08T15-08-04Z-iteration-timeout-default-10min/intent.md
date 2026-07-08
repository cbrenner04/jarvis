---
name: iteration-timeout-default-10min
---

# Default iteration timeout drops from 30 minutes to 10 minutes

`iterationTimeoutMs` currently defaults to `1_800_000` (30 min), letting a stalled
patch/review/shrink/prompt iteration run far past the point a wedge is obvious.
Lower the default to `600_000` (10 min) while keeping it operator-configurable.

## Decisions

- `DEFAULT_CONFIG.iterationTimeoutMs` becomes `600_000` — rules out silently
  keeping the 30-min default and only documenting the new number.
- Existing named watchdog-abort reasons (`iteration-timeout`, `actuator-timeout`,
  `shrink-timeout`) are unchanged; only the default duration moves.
- Operators can still override via config; the default is the hard-fail-fast
  policy, not a mandatory ceiling.

## Documentation updates

- `v1/docs/config.md`: update `iterationTimeoutMs` default value and example.
- `v1/docs/operator-runbook.md`: record the 10-minute hard-fail budget as
  operator policy — an operation over 10 min is a defect to fix, not tolerated.
- `v1/docs/run-loop.md` and `v1/docs/quota-signals.md`: update the "default 30
  minutes" references to 10 minutes where `iterationTimeoutMs` is cited.

## Acceptance criteria

- [ ] `DEFAULT_CONFIG.iterationTimeoutMs` is `600_000`.
- [ ] A patch/review/shrink/prompt iteration with no override times out at 10
      minutes by default, still overridable via config.
- [ ] Docs listing the `iterationTimeoutMs` default no longer say 30 minutes.

## Prerequisites
