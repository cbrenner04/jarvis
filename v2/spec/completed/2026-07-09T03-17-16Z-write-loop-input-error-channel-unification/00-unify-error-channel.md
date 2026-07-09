# Unify write-loop-input errors on generic usage text

## Problem

`requireLaunchFields` (`v2/src/execution/write-loop-input.ts`) accumulates a
per-field `errors` array that `parseWriteCliInput` (`v2/src/cli.ts`) discards
on failure, printing generic `WRITE_USAGE` text instead — the accumulation is
dead code. Separately, `buildWriteLoopInputFromCliValues` parses
`max-iterations` once to build a CLI-specific message, then
`buildWriteLoopInput` parses the same raw value again via
`requireLaunchFields`.

## Decisions

- Drop the per-field `errors` array; no test or caller asserts on its text
  (verified: no reference to `errors` outside `write-loop-input.ts` itself,
  no test asserts `positive integer` or `missing required field` output).
  Failure becomes a plain `{ ok: false }` — callers keep printing generic
  `WRITE_USAGE`.
- Drop the CLI-specific "Error: --max-iterations must be a positive integer"
  message along with it (no test asserts this text) — rules out keeping a
  second, narrower error channel alongside the generic one.
- `max-iterations` is parsed exactly once, inside `buildWriteLoopInput`'s
  existing `parseMaxIterations` call; `buildWriteLoopInputFromCliValues` no
  longer parses it up front — rules out two call sites parsing the same raw
  value.
- `WriteCliInput.message` in `cli.ts` stays (unrelated: it carries the
  machine-config load failure message, not a field-validation error).

## Task Checklist

- [ ] `BuildWriteLoopInputResult` (`write-loop-input.ts`) becomes
      `{ ok: true; input: WriteLoopInput } | { ok: false }`.
- [ ] `requireLaunchFields` and `requireString` drop their `errors`
      accumulator parameters; return `null`/`undefined` on failure without
      recording why.
- [ ] `parseMaxIterations` drops its `errors` parameter; still returns
      `number | undefined | null` (`null` = invalid).
- [ ] `buildWriteLoopInput` stops threading an `errors` array; still returns
      `{ ok: false }` when any required field or `maxIterations` is invalid.
- [ ] `buildWriteLoopInputFromCliValues` no longer calls `parseMaxIterations`
      itself; it maps CLI values to fields and delegates entirely to
      `buildWriteLoopInput` for parsing (including `maxIterations`). Its
      return type is `BuildWriteLoopInputResult` (no extra `message` case).
- [ ] `parseWriteCliInput` (`cli.ts`) updates its handling of a failed
      `buildWriteLoopInputFromCliValues` result to the new no-message shape
      (still returns `{ ok: false, message }` for the unrelated
      machine-config load failure).
- [ ] `cli.test.ts` gets a new test, alongside "missing required write args
      prints usage and exits 1", that runs the CLI with an invalid
      (non-positive, non-integer) `--max-iterations` value and asserts exit 1
      with stderr exactly `usage: jarvis write ...` text and no other
      message.

## Acceptance criteria

- [x] `jarvis write` / `jarvis run start` with a missing required flag still
      exits 1 and prints `usage: jarvis write ...` on stderr (behavior
      unchanged; see `cli.test.ts` "missing required write args prints usage
      and exits 1").
- [x] `jarvis write` / `jarvis run start` with an invalid (non-positive,
      non-integer) `--max-iterations` value exits 1 and prints
      `usage: jarvis write ...` on stderr, with no other message (see new
      `cli.test.ts` invalid-`--max-iterations` test above).
- [x] `write-loop-input.test.ts` and `cli.test.ts` stay green.
- [x] No call site parses a raw `max-iterations` CLI value more than once
      (verified by reading `buildWriteLoopInputFromCliValues` — a single
      `parseMaxIterations` call site remains, inside `buildWriteLoopInput`).

## Documentation updates

None — no operator-facing or documented behavior changes; error text was
already generic `WRITE_USAGE` from the operator's perspective in the missing-
field case, and the max-iterations-specific message was untested/undocumented
internal detail.
