# 01 - Default the idle watchdog on

## Problem

`idleOutputTimeoutMs` is unset by default (`v1/src/config.ts`), so the idle watchdog never arms unless explicitly configured. The #335 finish-line hang therefore rode the full 1800000 ms `iterationTimeoutMs` instead of dying in seconds. With subspec 00 making the watchdog file-activity-aware (no longer false-kills silent-but-productive work), it is now safe to arm by default.

## Decisions

- Default `idleOutputTimeoutMs` to `600000` (10 min) when unset. Rules out leaving it off (the #335 stall) and rules out a tighter default — 300000 false-killed productive work in the batch before 00's calibration; 600000 is the validated compromise.
- `idleOutputTimeoutMs: 0` disables the watchdog; extend the validator to accept `0` as the disable sentinel. Rules out positive-only validation, which after defaulting on would leave no off switch.
- Flip the arming guard from "defined/truthy" to `> 0`. After defaulting to 600000 the value is always set, so the `0`-disables behavior requires the guard to test `> 0`, not definedness. Rules out leaving the guard on definedness, which would arm even at `0`. Every spawn site subspecs 03–04 wire must inherit this same `> 0` guard.
- Requires subspec 00 (file-activity liveness) merged first, so default-on does not reintroduce the #346 false-kill.

## Task checklist

- [ ] Default `idleOutputTimeoutMs` to `600000` when unset in config resolution.
- [ ] Flip the watchdog arming guard from defined/truthy to `> 0`.
- [ ] Extend the `idleOutputTimeoutMs` validator to accept `0` (disable); reject negatives.
- [ ] Update the existing "disabled when unset" test to reflect default-on, and add a "disabled when set to 0" test.

## Acceptance criteria

- [ ] With no `idleOutputTimeoutMs` configured, the idle watchdog is armed at 600000 ms.
- [ ] `idleOutputTimeoutMs: 0` disables the idle watchdog (no idle abort regardless of silence).
- [ ] A negative `idleOutputTimeoutMs` is rejected with a config validation error.
- [ ] Idle-watchdog tests and any config-default tests asserting `idleOutputTimeoutMs` unset (including `v1/test/run.sandbox-unrunnable.test.ts`) stay green after updating the unset case to expect default-on.

## Documentation updates

- `v1/docs/run-loop.md` — "Idle-output watchdog": default is now 600000 ms; `0` disables.
- `v2/docs/v1-behaviors.md` — config table default for `idleOutputTimeoutMs` changes from `unset` to `600000`; note `0` disables.
