# 00 - Spawn cursor with stream-json and parse its envelope

## Problem

`shared/invocation/agents.ts` spawns cursor as `cursor agent -p --output-format text …`. In `text`
mode the CLI emits nothing until its final response, so a silently-editing role produces zero stdout
for the whole edit phase. `armIdleTimer` sees silence and settles `{ kind: "stall" }` at exactly the
idle budget → `invocation_failure` / `failureKind: "stall"` → `role_stalled`, non-retryable, and the
committed write step is discarded. Observed 2026-07-24 at `dur=90003` on
`state-store-wal-concurrent-writes`, twice, with edits already on disk.

Claude was fixed the same way (`--output-format stream-json --verbose` plus a terminal-result-event
reader). Cursor never got that fix.

## Decisions

- Spawn cursor with `--output-format stream-json --stream-partial-output`. Rules out raising
  `idleOutputMs`, which lengthens every real stall and still cannot distinguish silent-working from
  hung.
- Flag and reader land together. The flag alone regresses cursor result text to raw NDJSON and
  leaves quota phrases buried in JSON escaping.
- Parse cursor's NDJSON in a cursor-specific reader, not `parseClaudeJsonOutput`. Rules out reusing
  claude's parser, which returns `""` when the terminal event carries no string `result` field —
  cursor's envelope shape is not claude's contract and a mismatch would silently blank the actuator's
  output.
- Reader is tolerant, in this order: last `type: "result"` event's string `result`; else concatenated
  assistant/text-delta frame text; else raw stdout verbatim. Rules out strict parsing that throws
  away output when the CLI's frame vocabulary shifts under a version bump.
- Quota / model-config / error classification keeps running on raw `stdout`+`stderr`, before reader
  normalization. Rules out classifying the parsed display text, which drops error frames the current
  `text`-mode patterns match on.
- No usage or cost extraction from cursor frames. `Deferred to first consumer: cursor usage/cost from
  stream-json frames — pin when a caller needs it` (v2 consumes no cursor usage today).
- Scope is `shared/invocation/` only. v1's own `v1/src/agents/cursor.ts` adapter is untouched
  (v1 is maintenance-only).

## Task checklist

- [ ] Swap cursor's `buildArgv` to `--output-format stream-json --stream-partial-output`.
- [ ] Add the cursor stream-json reader and apply it to `kind: "ok"` cursor results only.
- [ ] Tests: argv, idle-clock reset on frames, envelope parsing, fallbacks, silent-stall preservation.
- [ ] Docs.

## Acceptance criteria

- [x] Cursor argv contains `--output-format stream-json` and `--stream-partial-output` and does not
      contain `text`; a test in `shared/invocation/agents.test.ts` asserts it and fails against
      pre-fix code.
- [x] A cursor invocation emitting stream frames at intervals shorter than `idleOutputMs`, with no
      final text until exit, settles `ok` rather than `stall`; the test fails against pre-fix code
      only if frames are ignored for idle purposes.
- [x] A cursor `ok` result surfaces the terminal `result` event's text as `stdout` (not raw NDJSON);
      a new test asserts it and fails against pre-fix code.
- [x] Unparseable or result-event-less cursor stdout surfaces verbatim rather than empty.
- [x] Existing cursor quota-classification tests in `shared/invocation/agents.test.ts` stay green
      (zero-exit and non-zero-exit paths), and a quota phrase arriving inside a stream-json frame
      still classifies `quota`.
- [x] An output-silent cursor invocation past `idleOutputMs` still settles `{ kind: "stall" }`
      (`shared/invocation/agents.test.ts` idle-expiry test stays green).
- [x] Inverting each added or modified guard in the reader and the classification path fails at least
      one test; for the guard that suppresses reader normalization on non-`ok` results, the negative
      case proves a non-`ok` cursor result is passed through unnormalized.
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Choosing an actuator — cursor now streams to the watchdog like
  claude; drop the implication that cursor actuator stalls are unavoidable.
- `v2/docs/v1-behaviors.md` § Adapter-specific behavior — record that shared/v2 spawns cursor with
  `--output-format stream-json --stream-partial-output` and parses the stream envelope for result
  text, distinct from v1's `text`-mode adapter.
