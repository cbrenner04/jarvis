# Cleanup session-log retention config

## Problem

Cleanup has no machine-config knob for session-log retention; an operator cannot tune the window and there is no validation surface for a bad value.

## Decision ledger

- Machine config key `cleanup.sessionLogRetentionDays` lives under a top-level `cleanup` object in `~/.jarvis/config.json`; rules out a flat top-level key that collides with future cleanup settings.
- Absent `cleanup` or absent `cleanup.sessionLogRetentionDays` resolves to 14 days; rules out unbounded retention when the key is omitted.
- Valid values are positive integers (`Number.isInteger` and `> 0`); rules out fractional days or zero meaning "delete everything now".
- Invalid values return a structured refusal for the session-log slice only; rules out coercing strings, floats, or zero into a window.
- Deferred to first consumer: whether invalid retention makes the whole cleanup invocation exit nonzero — pin when operator-runbook prose in subspec 02 lands; this subspec only defines the reader contract.

## Prerequisites

- `readMachineConfigDocument` and nested project-field readers in `v2/src/config/machine-config-loader.ts`.

## Task checklist

- Add `readCleanupSessionLogRetentionDays(configPath?)` returning `{ ok: true; days: number }` or `{ ok: false; error: string }` naming `cleanup.sessionLogRetentionDays` on invalid input.
- Default 14 when the `cleanup` object or `sessionLogRetentionDays` field is absent.
- Add `v2/src/config/machine-config-loader.test.ts` coverage for absent default, valid override, and representative invalid values (non-integer, zero, negative, non-number).

## Acceptance criteria

- [x] `v2/src/config/machine-config-loader.test.ts` proves absent `cleanup.sessionLogRetentionDays` resolves to 14 days, a positive integer override is returned unchanged, and each invalid value yields `{ ok: false }` naming `cleanup.sessionLogRetentionDays`; it fails against the pre-fix missing reader.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- None — operator and config prose land in subspecs 02–03 after the reader exists.
