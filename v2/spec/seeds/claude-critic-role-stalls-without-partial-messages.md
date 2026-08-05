---
name: claude-critic-role-stalls-without-partial-messages
---

# Claude review-critic (and long no-tool roles) stall at the idle watchdog

Under a claude-first agent order, review-bearing Jarvis steps fail: the review
**critic** role settles `role_stalled` / `failureKind: "stall"` at the 90s idle
bound while claude is still working. This makes claude unusable as the primary
agent for `intent`, `plan`, and any review pass, and broke the full-review
pipeline for bundle 2 (`implement-completion-honesty`) on 2026-08-05
(`failureKind: stall`, `boundMs: 90000`, `agent: claude`, `model: claude-sonnet-5`,
`"intent review: critic invocation failed (stall)"`).

## Root cause

Not a general "jarvis can't see claude" bug — the historical zero-stdout defect
(#1450 v1, #1509 v2) was already fixed by `--output-format json` →
`stream-json --verbose`. What remains is narrower:

- The claude adapter argv in `runClaudeBinding` (`shared/invocation/agents.ts:586-595`)
  is `["-p","--permission-mode","acceptEdits","--model",<m>,"--output-format","stream-json","--verbose"]`.
  With `stream-json --verbose` but **no `--include-partial-messages`**, claude emits
  only *whole* events: a `system init` line at t≈0, then nothing until the final
  assistant/`result` flush.
- The critic reviews a unified diff baked into its prompt
  (`shared/prompts/review-implement.ts` `BRANCH_DIFF`), so it makes **zero tool
  calls** — one long silent turn. The `system init` line resets the idle timer once
  at t≈0; nothing resets it again during the turn, so `armIdleTimer`
  (`agents.ts:280-293`) fires at `idleOutputMs` (default 90_000) → `forcedResult =
  { kind: "stall" }`.
- The watchdog already listens on **both** stdout and stderr
  (`agents.ts:358-362`, `370-374`) — that is not the gap. The bytes simply do not
  exist yet. Not a PTY or capture-buffering problem.
- Verdict path: `review-role-invocation.ts` (`DEFAULT_IDLE_OUTPUT_TIMEOUT_MS =
  90_000`) → claude binding → `runClaudeBinding`; a `stall` with no wall/abort maps
  to `reviewRoleFailureKind` `"stall"`.

Cursor does not stall because its argv (`runCursorBinding`, `agents.ts:861-873`)
includes `--stream-partial-output`, emitting token-level deltas continuously so
stdout never goes quiet.

## Decisions

- Add `--include-partial-messages` to the claude argv in `runClaudeBinding`
  (append after `--verbose`) — the direct analog of cursor's
  `--stream-partial-output`. Claude then emits `stream_event` partial-delta lines as
  tokens arrive, continuously resetting the idle timer even on a long no-tool turn.
- The flag requires `-p` + `stream-json` + `--verbose`, all already present.
- No parser change: `parseClaudeJsonOutput` / `findTerminalResultEvent`
  (`shared/invocation/claude-json.ts`) already select only the terminal
  `type:"result"` event and skip every other NDJSON line, so extra partial events do
  not affect `displayText`, usage, or cost.
- Do **not** raise/disable the idle bound for claude (forfeits stall protection) and
  do **not** add a PTY (unnecessary once claude streams).

## Acceptance criteria

- [ ] `runClaudeBinding` argv includes `--include-partial-messages` after
      `--verbose`; the pinned-argv regression (`shared/invocation/agents.test.ts:226-235`,
      `toEqual([...])`) is updated to assert it and fails against the current argv.
- [ ] `parseClaudeJsonOutput` still returns the terminal-result `displayText`, usage,
      and cost when the NDJSON stream interleaves `stream_event` partial-delta lines
      before the final `type:"result"` event; a regression feeds partial events + a
      result and asserts the parse is unchanged.
- [ ] Mutation checkpoint: a `// @mutate` directive removing `--include-partial-messages`
      from the claude argv turns the pinned-argv test RED. Pin via the unique-basename
      test `shared/invocation/agents.test.ts` (reference it uniquely; `agents.test.ts`
      is unique in the repo).
- [ ] (Manual / no automated guard) A claude review-critic role over a large diff
      emits incremental stdout and completes without hitting the idle bound.
- [ ] `bun run typecheck` and the touched surfaces' test scripts pass (`shared/**`
      change → full test per CI scope rule).

## Documentation updates

- `v2/docs/operator-runbook.md` — remove/correct any note implying claude is
  unusable for review roles due to output blindness; record that claude-first review
  works once `--include-partial-messages` is passed.
- Update memory-adjacent operator lore (the "claude isn't slow, jarvis can't see it"
  note) is now scoped to the long-no-tool-turn case and fixed by this change.

## Prerequisites

- `runClaudeBinding` / `runCursorBinding` argv builders and the idle watchdog
  (`armIdleTimer`, stdout/stderr handlers) in `shared/invocation/agents.ts`
- `parseClaudeJsonOutput` / `findTerminalResultEvent` (`shared/invocation/claude-json.ts`)
- Pinned-argv tests in `shared/invocation/agents.test.ts`
- Review-role idle budget + stall mapping in `v2/src/execution/review-role-invocation.ts`
