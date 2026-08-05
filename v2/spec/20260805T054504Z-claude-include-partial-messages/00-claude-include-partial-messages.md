# 00 - Pass `--include-partial-messages` on claude argv

## Problem

`runClaudeBinding` (`shared/invocation/agents.ts:586`) spawns claude with `--output-format stream-json --verbose` but without
`--include-partial-messages`. On a long no-tool turn (review critic with diff baked into the
prompt), claude emits a `system init` line then silence until the final `type:"result"` flush.
`armIdleTimer` resets once at t≈0; nothing resets it again → `{ kind: "stall" }` at
`idleOutputMs` (default 90 s) → review `failureKind: "stall"` while claude is still working.
Cursor avoids this via `--stream-partial-output`.

## Decisions

- Append `--include-partial-messages` after `--verbose` in `runClaudeBinding` argv — rules out raising/disabling the idle bound or adding a PTY.
- Flag requires `-p`, `stream-json`, and `--verbose` (all already present).
- **v1 blast radius accepted:** the flag lands in `shared/invocation`, so v1 plan/review/shrink paths that already use the shared claude binding pick it up and inherit the same idle-watchdog benefit. The v1-local spawn in `v1/src/agents/claude.ts` stays unchanged; do not imply v1 is untouched overall.
- No `parseClaudeJsonOutput` change — terminal `type:"result"` selection already skips `stream_event` partial lines — rules out a parallel partial parser.
- **No-result fallback accepted as-is:** on zero-exit with no terminal `type:"result"`, the parser already falls back to raw stdout (now a larger blob including `thinking_delta` when partials were streamed). Cursor-style text-frame fallback is out of scope — the happy path is a terminal result event; the degenerate case keeps today's warning + raw-stdout behavior.
- **Non-zero quota phrase-matching widened, not redesigned:** zero-exit quota detection stays safe via structured envelope checks. Non-zero settlement still concatenates stdout into diagnostics where quota patterns can match model prose; partial/thinking text widens a pre-existing hazard (analogous to the cursor stream-json note in `v1-behaviors.md`). No classification redesign in this spec.
- Do not raise or disable claude's idle bound — rules out forfeiting stall protection.
- **Time-to-first-token assumption:** `--include-partial-messages` streams thinking and assistant deltas once they start; the remaining stall window is spawn through first token on large prompts (seconds, not 90 s). The manual AC validates this — not grounds to re-scope.
- **Flag-availability assumption:** an unknown CLI flag fails every claude spawn in both engines with no graceful cascade. The operator's installed claude CLI exposes `--include-partial-messages` (single-operator repo).

## Task checklist

- [ ] Add `--include-partial-messages` after `--verbose` in `runClaudeBinding` `buildArgv`.
- [ ] Update the pinned claude argv test in `shared/invocation/agents.test.ts`; add `// @mutate shared/invocation/agents.ts "--include-partial-messages" -> ""` on that test.
- [ ] Add a `parseClaudeJsonOutput` regression in `shared/invocation/claude-json.test.ts` with interleaved `stream_event` partial lines before a terminal result.
- [ ] Add a claude idle-watchdog threading guard in `shared/invocation/agents.test.ts` (mirror the cursor binding test; frame as wiring guard, not proof the flag fixes stalls).
- [ ] Align `v2/docs/operator-runbook.md`, `v2/docs/shared-invocation.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `runClaudeBinding` argv includes `--include-partial-messages` after `--verbose`; the pinned-argv regression in `shared/invocation/agents.test.ts` (`toEqual([...])`) asserts it and fails against the current argv.
- [ ] `parseClaudeJsonOutput` still returns terminal-result `displayText`, usage, and cost when NDJSON interleaves `stream_event` partial-delta lines before the final `type:"result"` event; a regression in `shared/invocation/claude-json.test.ts` feeds partial events plus a result and asserts unchanged parse output.
- [ ] Mutation checkpoint: `// @mutate shared/invocation/agents.ts "--include-partial-messages" -> ""` on the pinned-argv test turns it RED; pin via `shared/invocation/agents.test.ts` (unique basename).
- [ ] `shared/invocation/agents.test.ts` includes a claude binding test that threads `idleOutputMs` through and re-arms the idle timer on stdout chunks; comments frame it as a wiring guard (wrapper still hands timer hooks to `runAgent`), not proof that `--include-partial-messages` fixes review stalls.
- [ ] `v2/docs/shared-invocation.md` claude branch lists `--include-partial-messages` in the spawned argv; `v2/docs/v1-behaviors.md` "Shared claude adapter stream-json support" narrows/replaces the existing "matches v1's spawn and parse contract" claim, records `--include-partial-messages` as a v2 divergence, and notes the widened non-zero quota phrase-matching exposure; the v1-local `claude` argv bullet in the same doc stays unchanged; `v2/docs/operator-runbook.md` § Choosing an actuator scopes the claude output-visibility note to long no-tool turns (stream-json without partials) and records that claude-first review/critic roles work once the flag is passed.
- [ ] (Manual / no automated guard) A claude review-critic role over a large diff emits incremental stdout and completes without hitting the idle bound.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Choosing an actuator: scope the existing claude streaming claim to exclude long no-tool turns without partials; record claude-first review/critic roles work once `--include-partial-messages` is passed.
- `v2/docs/shared-invocation.md` — claude branch argv includes `--include-partial-messages` after `--verbose`.
- `v2/docs/v1-behaviors.md` — "Shared claude adapter stream-json support": narrow/replace the "matches v1's spawn and parse contract" sentence; record `--include-partial-messages` as a v2 divergence and the widened non-zero quota phrase-matching exposure; leave the v1-local `claude` argv bullet unchanged.
