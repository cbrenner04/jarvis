---
name: codex-invocations-record-no-cost-or-usage
---

# Every codex invocation records null cost and null usage, with no warning saying why

`~/.jarvis/telemetry.jsonl`, all 11 codex invocations on 2026-07-14:

```json
{"agent":"codex","exit_kind":"ok","cost_usd":null,"cost_source":"unavailable",
 "usage":{"input_tokens":null,"output_tokens":null,"cache_read_input_tokens":null,"cache_creation_input_tokens":null},
 "warnings":null}
```

Not one token, not one cent, on a run that did real work and exited `ok`. The session's cost sheet
attributes **$12.73 to claude across 17 invocations and $0.00 to codex across 11** — codex looks
free, and it is not.

**The silence is the bug.** `shared/invocation/agents.ts` reconstructs codex usage by finding the
session JSONL that changed during the invocation, and it has three explicit failure warnings for
when it cannot (`agents.ts:685`, `:706`, `:713`):

- `codex usage unavailable: no session JSONL changed after this invocation`
- `codex usage unavailable: no changed session file matched this invocation marker and cwd`
- `codex usage unavailable: multiple session files matched this invocation; refusing to guess: …`

**None of them fired.** Every row carries `warnings: null`. So the scrape is not failing one of its
known ways — it is producing `unavailable` on a path that emits no diagnostic at all. Whatever the
cause, the operator gets no signal: the cost is simply gone, and nothing says so.

This is the same class as the P0 `shared-invocation-loses-cost-and-claude-output` (#1509), which
fixed **claude** by spawning it with `--output-format stream-json --verbose` so usage arrives on the
invocation's own stream. Codex still relies on scraping a side-channel file after the fact, and that
side channel is not delivering.

It matters now, not eventually: codex is being trialled as an implement primary, and the
[cost-reporting standard](../../v1/docs/operator-runbook.md#cost-reporting-standard) makes
`telemetry.jsonl` the source of record for v2 spend. A codex-primary session cannot be costed at all.

## Decisions

- A codex invocation that cannot produce usage **emits a warning naming why**, on every path.
  A `cost_source: "unavailable"` row with `warnings: null` is the defect — fix that first, because
  it is what hid this. Rules out shipping a cost fix that is again unobservable when it regresses.
- Codex usage comes from the invocation's own output stream where the CLI can supply it, as claude's
  now does — not from correlating an external session file by mtime and cwd. Rules out keeping a
  scrape whose failure mode is silence.
- If the codex CLI genuinely cannot report usage, the row says so explicitly (a stable
  `cost_source` value and a warning), so the cost sheet can state the hole rather than imply $0.
  Rules out a null that reads as free.

## Prerequisites

- None. #1509 shipped the streaming-usage pattern for claude; this applies it to codex.

## Out of scope

- Codex pricing rows in `data/prices.json` — irrelevant while token counts are null.
- cursor's usage reporting (`cursor-streams-tool-activity`).

## Documentation updates

- `v1/docs/operator-runbook.md` § Cost reporting standard — it lists two known cost holes; codex is
  a third and currently undocumented, so a codex-driven session is silently uncostable.
- `v2/docs/operator-runbook.md` § Choosing an actuator — note the attribution gap until this ships.
