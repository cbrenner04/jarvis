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
- No `parseClaudeJsonOutput` change — terminal `type:"result"` selection already skips `stream_event` partial lines — rules out a parallel partial parser.
- Do not raise or disable claude's idle bound — rules out forfeiting stall protection.

## Task checklist

- [ ] Add `--include-partial-messages` after `--verbose` in `runClaudeBinding` `buildArgv`.
- [ ] Update the pinned claude argv test in `shared/invocation/agents.test.ts`; add `// @mutate` on that test.
- [ ] Add a `parseClaudeJsonOutput` regression in `shared/invocation/claude-json.test.ts` with interleaved `stream_event` partial lines before a terminal result.
- [ ] Align `v2/docs/operator-runbook.md`, `v2/docs/shared-invocation.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `runClaudeBinding` argv includes `--include-partial-messages` after `--verbose`; the pinned-argv regression in `shared/invocation/agents.test.ts` (`toEqual([...])`) asserts it and fails against the current argv.
- [ ] `parseClaudeJsonOutput` still returns terminal-result `displayText`, usage, and cost when NDJSON interleaves `stream_event` partial-delta lines before the final `type:"result"` event; a regression in `shared/invocation/claude-json.test.ts` feeds partial events plus a result and asserts unchanged parse output.
- [ ] Mutation checkpoint: a `// @mutate` directive removing `--include-partial-messages` from the claude argv turns the pinned-argv test RED; pin via `shared/invocation/agents.test.ts` (unique basename).
- [ ] `v2/docs/shared-invocation.md` claude branch lists `--include-partial-messages` in the spawned argv; `v2/docs/v1-behaviors.md` "Shared claude adapter stream-json support" records it as a v2 divergence with the v1 claude argv bullet unchanged; `v2/docs/operator-runbook.md` § Choosing an actuator scopes the claude output-visibility note to long no-tool turns and records that claude-first review/critic roles work with the flag.
- [ ] (Manual / no automated guard) A claude review-critic role over a large diff emits incremental stdout and completes without hitting the idle bound.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove/correct lore that claude is unusable for review roles due to output blindness; record claude-first review works once `--include-partial-messages` is passed; scope the "jarvis can't see claude" note to the long-no-tool-turn case fixed here.
- `v2/docs/shared-invocation.md` — claude branch argv includes `--include-partial-messages` after `--verbose`.
- `v2/docs/v1-behaviors.md` — shared claude adapter stream-json section records the added flag as a v2 divergence; the v1 claude argv bullet is unchanged.
