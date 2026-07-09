---
name: write-loop-input-error-channel-unification
---

# Unify write-loop-input error reporting and drop the double-parse

## Problem

`requireLaunchFields` (`v2/src/execution/write-loop-input.ts:98`) accumulates
a per-field `errors` array, but `parseWriteCliInput`
(`v2/src/cli.ts:436-457`) discards it on failure and prints generic
`WRITE_USAGE` text instead — the accumulated errors are dead. Separately,
`buildWriteLoopInputFromCliValues` (`write-loop-input.ts:66-77`) calls
`parseMaxIterations` directly to build a CLI-specific message, then calls
`buildWriteLoopInput`, which parses the same raw value again via
`requireLaunchFields`.

## Direction

Pick one error channel and delete the other; remove the double-parse of
`maxIterations`.

## Decisions

- Deferred to first consumer: keep the per-field `errors` array (and surface
  it to the CLI instead of generic `WRITE_USAGE` text) vs keep generic usage
  text (and delete `requireLaunchFields`'s accumulation) — pin by checking
  whether any current test or caller asserts on the specific per-field error
  text; if none do, prefer generic usage text as the simpler surface.
- `buildWriteLoopInputFromCliValues` gets `maxIterations`'s parsed value from
  the single `buildWriteLoopInput`/`requireLaunchFields` pass instead of
  parsing it again for the CLI-specific message — rules out keeping two call
  sites for the same raw-value parse.

## Prerequisites
