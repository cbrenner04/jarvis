# 00 - Idle default 90s, centralized

## Problem

`idleOutputTimeoutMs` defaults to `600000`, identical to the `iterationTimeoutMs`
default (`v1/src/config.ts:169-170`). The idle timer resets on every output or file-activity
tick, so 600s of continuous silence can only be reached after the iteration has already
burned its full 600s wall — the wall (terminal, no cascade) always fires first. Idle
escalation is therefore unreachable under shipped defaults for every agent and every phase.

The `600000` fallback is also duplicated across call sites rather than read from one
constant, so the default cannot be changed in one place.

## Decisions

- Default `idleOutputTimeoutMs` becomes `90_000`. Rules out both keeping 600s (escalation stays dead) and a tighter value like 30s (a slow agent pausing between tool calls would be killed as a stall).
- Fix the default, not `iterationTimeoutMs`. Raising the wall would slow every real terminal stall; the wall's job is unchanged.
- Export one `DEFAULT_IDLE_OUTPUT_TIMEOUT_MS` constant from `v1/src/config.ts` and have every `?? 600000` fallback read it. Rules out patching only `DEFAULT_CONFIG` — the per-site literals would keep the old value alive on paths that take a raw/partial config.
- The intent names four sites; the repo has eight. All must move: `config.ts` (`DEFAULT_CONFIG`, the `validateNonNegativeIntegerWithZeroDisable` fallback, and the `!== 600000` normalization-omit check), `modes/plan/{draft,review,verdict-actuator}.ts`, `modes/patch/{review,shrink,iteration}.ts`. Leaving any behind reintroduces the bug on that phase.
- `0` still disables the watchdog; the config surface and validation are otherwise unchanged.

## Out of scope

- The `iterationTimeoutMs` default.
- Adding idle detection where it does not exist (`subRoleAgentOrder.reviewActuator` behavior is unchanged).

## Acceptance criteria

- [x] With no `idleOutputTimeoutMs` in config, a patch implementation agent that goes silent past the idle threshold — while the iteration wall still has time left — escalates to the next `modes.patch.agentOrder` rung rather than riding the wall to a terminal timeout. Covered by a new test that supplies default config (not an explicit low threshold, as existing watchdog tests do).
- [x] The effective default idle threshold is `90000`ms and is defined once; no source file outside that definition hardcodes `600000` as an idle fallback.
- [x] A config file with no `idleOutputTimeoutMs` key round-trips through `jarvis config` normalization without gaining one (the default is still omitted from the written config).
- [x] `idleOutputTimeoutMs: 0` still disables the watchdog.
- [x] Existing idle-escalation tests in `v1/test/run.test.ts`, `v1/test/modes/patch/review.test.ts`, and `v1/test/modes/patch/shrink.test.ts` stay green (explicit-threshold behavior unchanged).

## Documentation updates

- `v1/docs/config.md` — the type comment (line ~74) still says "unset by default (disabled)", which is wrong. State the real default (`90000`), that both timeouts arm together and whichever fires first aborts, and that the idle threshold is a stall heuristic chosen from observed inter-output gaps, not a performance budget. Update the sample-config comment (line ~228) accordingly.
- `v1/docs/run-loop.md` — "Default is 600000 (10 minutes)" in the idle-output-watchdog section is now wrong.
- `v1/docs/operator-runbook.md` — the idle-escalation paragraph in the Manual-finalize recovery section describes escalation as live; note that it is now actually reachable under defaults (previously the wall pre-empted it).
- `v2/docs/v1-behaviors.md` — the config table row and the idle-watchdog behavior entry both cite `600000` as the default.
