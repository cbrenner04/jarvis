---
name: claude-include-partial-messages
---

# Claude binding streams partial messages so long no-tool turns survive the idle watchdog

Touches one module-boundary surface (`shared/invocation`); operator-runbook alignment documents the same behavior per documentation-standard.

Under claude-first agent order, review **critic** roles stall at `failureKind: "stall"` (`boundMs: 90000`) while claude is still working. `stream-json --verbose` without `--include-partial-messages` emits only a `system init` line then silence until the final `result`; zero-tool critic turns (diff baked into prompt) never reset `armIdleTimer`. Cursor avoids this via `--stream-partial-output`.

## Decisions

- Append `--include-partial-messages` after `--verbose` in `runClaudeBinding` argv — rules out raising/disabling the idle bound or adding a PTY.
- Flag requires `-p`, `stream-json`, and `--verbose` (all already present).
- No `parseClaudeJsonOutput` change — terminal `type:"result"` selection already skips `stream_event` partial lines — rules out a parallel partial parser.
- Do not raise or disable claude's idle bound — rules out forfeiting stall protection.

## Acceptance criteria

- [ ] `runClaudeBinding` argv includes `--include-partial-messages` after `--verbose`; the pinned-argv regression in `shared/invocation/agents.test.ts` (`toEqual([...])`) asserts it and fails against the current argv.
- [ ] `parseClaudeJsonOutput` still returns terminal-result `displayText`, usage, and cost when NDJSON interleaves `stream_event` partial-delta lines before the final `type:"result"` event; a regression in `shared/invocation/claude-json.test.ts` feeds partial events plus a result and asserts unchanged parse output.
- [ ] Mutation checkpoint: a `// @mutate` directive removing `--include-partial-messages` from the claude argv turns the pinned-argv test RED; pin via `shared/invocation/agents.test.ts` (unique basename).
- [ ] (Manual / no automated guard) A claude review-critic role over a large diff emits incremental stdout and completes without hitting the idle bound.
- [ ] `bun run typecheck` and full test suite pass (`shared/**` change → full test per CI scope rule).

## Documentation updates

- `v2/docs/operator-runbook.md` — remove/correct lore that claude is unusable for review roles due to output blindness; record claude-first review works once `--include-partial-messages` is passed; scope the "jarvis can't see claude" note to the long-no-tool-turn case fixed here.
- `v2/docs/shared-invocation.md` — claude branch argv includes `--include-partial-messages` after `--verbose`.
- `v2/docs/v1-behaviors.md` — shared claude adapter stream-json section records the added flag as a v2 divergence; the v1 claude argv bullet is unchanged.

## Prerequisites

- `runClaudeBinding` spawns claude with `-p`, `stream-json`, and `--verbose` and arms idle-output watchdog on stdout/stderr chunks
- `parseClaudeJsonOutput` selects only the terminal `type:"result"` NDJSON event from the stdout stream
- Review-role invocations pass `idleOutputMs` (default 90s) into the shared binding and map stall failures to `failureKind: "stall"`
