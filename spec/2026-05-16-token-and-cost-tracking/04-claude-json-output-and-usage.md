# 04 — Claude JSON output and usage extraction

## Problem

Claude is the agent we run most. It is the one for which getting real usage
data is most valuable, and the one with the cleanest path to that data:
`claude -p --output-format json` emits a structured envelope that includes
a `usage` block (`input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, `cache_read_input_tokens`) and on newer
versions a `total_cost_usd`.

This subspec switches `claude -p` to JSON output, parses the envelope to
extract usage, reformats the assistant prose so the user-visible terminal
and session-log output are not regressed, and threads the usage through to
the per-iteration telemetry record.

This is the riskiest subspec in the spec because it changes how Claude's
output flows through the harness. Risks and mitigations are listed under
"Decisions" below.

## Decisions

- **CLI flag change.** `src/agents/claude.ts` switches from plain text
  (default) to `--output-format json`. The flag is added to the existing
  argv array; nothing else in the spawn is touched.
- **Why JSON, not stream-json.** The non-streaming `json` output gives us
  a single envelope after the run finishes, which matches our
  one-shot-per-iteration model. `stream-json` adds complexity (tool-call
  events, partial messages) we do not need for usage extraction.
- **Adapter location**: `src/agents/claude-json.ts` exporting
  `parseClaudeJsonOutput(stdout: string): ClaudeParseResult`. Claude
  agent stays the orchestrator; the parser is an isolated, fixture-tested
  pure function.
- **`ClaudeParseResult` shape:**

  ```ts
  export type ClaudeParseResult = {
    displayText: string; // What we surface to terminal + session log
    usage: TelemetryUsage | null;
    cost_usd: number | null;
    warnings: string[]; // Non-fatal parse anomalies
  };
  ```

- **Display reformatting.** The terminal + session log today see Claude's
  prose verbatim. With JSON output we synthesize the same prose by:
  - Walking the JSON envelope's message array (the exact path is
    version-dependent — see "Verify first" below).
  - Concatenating assistant text blocks with single blank lines.
  - Rendering tool calls in a stable, readable form: a single line per
    call like `[tool] <tool-name>: <truncated-args>` followed by the
    tool result on the next line, prefixed similarly. Truncation at 200
    chars with `...` suffix. Rationale: keeps the log scannable; users
    who want full tool I/O can re-run with `claude -p` directly.
  - Trimming trailing whitespace.
- **Parse failure is non-fatal.** When `parseClaudeJsonOutput` cannot
  parse the envelope (truncated stream, schema drift, etc.) the agent
  result is still treated as `kind: "ok"`:
  - `displayText` = the raw stdout (so the user sees something rather
    than nothing).
  - `usage` = `null`, `cost_usd` = `null`.
  - `warnings` includes a one-line description of what failed.
  - The harness emits a single `harness` log line per iteration:
    `claude: usage extraction failed (<reason>); recording usage as null`.
- **Cost source attribution.** When the envelope provides
  `total_cost_usd`, telemetry records `cost_usd: <that>` and
  `cost_source: "agent"`. When it does not but `usage` is populated,
  `runIteration` calls `computeCost` and records `cost_source:
  "computed"`. When neither is available, `cost_source: "no-usage"` and
  `cost_usd: null`.
- **`AgentResult` extension.** `src/agents/types.ts` adds an optional
  `usage` field to the `kind: "ok"` variant:

  ```ts
  | { kind: "ok"; stdout: string; stderr: string;
      usage?: TelemetryUsage; cost_usd?: number | null;
      cost_source?: "agent" | "computed" | "no-price" | "no-usage" }
  ```

  Other agents continue to omit these fields (subspecs 05–07 wire them
  up). The harness reads these off the result.
- **Stderr passthrough unchanged.** Claude still uses the `runAgent`
  spawn loop; stderr is captured and surfaced as today. JSON mode does
  not duplicate prose to stderr in any version we have seen, but if it
  does we let it through unchanged.
- **No streaming display.** Today `claude -p` prints prose to the
  terminal as the model produces it (within the limits of how the spawn
  loop buffers). With JSON output we only have the full envelope after
  exit, so the terminal shows the synthesized `displayText` once at the
  end of the iteration. This is a real user-experience regression we are
  accepting in exchange for usage data. Surface it as a warning in the
  harness banner the first time the iteration uses claude:
  `claude: terminal output is now end-of-iteration only (JSON parse mode)`.
  Print this once per `jarvis run`, not once per iteration. Skip the
  notice if a config flag turns it off (see next bullet).
- **Config opt-out.** Add `modes.patch.agents.claude.outputFormat` config
  option, valid values `"json"` (new default) and `"text"` (legacy). When
  set to `"text"`, the JSON adapter is bypassed entirely and behavior is
  exactly as today (no usage data extracted, terminal sees streaming
  prose). This gives users a one-line escape hatch if JSON mode regresses
  for them. Subspec only adds the option, default-on JSON; tests cover
  both code paths.
- **Verify first.** Before implementing, the implementer captures real
  output from `claude -p --output-format json` against at least two
  Claude Code versions (the one currently installed locally and one
  more, if available) and records the envelope shape under a `## Verified
  envelope` section in this file. Do not implement against the schema
  sketch in this subspec without verification — Anthropic has changed
  this schema before.

## Schema sketch (verify, do not ship blind)

Best guess from public Claude Code docs at authoring time:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 12345,
  "duration_api_ms": 9000,
  "num_turns": 1,
  "result": "Final assistant prose here.",
  "session_id": "...",
  "total_cost_usd": 0.043,
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 567,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 8910
  }
}
```

In some versions the messages are emitted as a sequence of objects (one
per message) rather than as a single result object. The adapter must
handle both: try parsing as a single result envelope; if that fails, try
parsing as line-delimited messages and look for the `result`/`usage`
fields on the last one.

## Tasks

- [x] **Verify first.** Run `claude -p --output-format json` locally
      against a trivial prompt; capture stdout to a fixture file under
      `test/fixtures/claude/`. Repeat against a second Claude Code
      version if reasonably available (e.g. via `npx
      @anthropic-ai/claude-code@<older>`). Record findings under
      `## Verified envelope` in this file.
- [ ] Save captured fixtures as
      `test/fixtures/claude/<version>-<scenario>.json` covering at
      minimum: simple prose response, response with tool calls, response
      that hit the model's max tokens (truncated), response when claude
      itself errored mid-stream (envelope incomplete).
- [ ] Create `src/agents/claude-json.ts` exporting
      `parseClaudeJsonOutput(stdout)` per the `ClaudeParseResult` shape
      above.
- [ ] Update `src/agents/claude.ts`:
      - Add `--output-format json` to the argv (gated by the new config
        option; default is `"json"`).
      - After a successful `runAgent` call, run the parser, attach
        `usage`/`cost_usd`/`cost_source` to the result, and replace
        `result.stdout` with `displayText` so existing fanout code
        unchanged.
      - On parse failure, emit a single `harness`-tagged warning via
        the existing logging plumbing (the warning is queued by the
        agent and consumed by `runIteration` — define a minimal
        mechanism that does not require restructuring the agent
        interface; see implementation note below).
- [ ] Implementation note for the warning channel: extend `AgentResult`'s
      `kind: "ok"` variant with an optional `warnings: string[]` field
      that the harness reads and forwards to `fanout("harness", ...)`.
      Keeps the agent interface unchanged for the other three agents.
- [ ] Update `src/agents/types.ts` per the `AgentResult` extension above.
- [ ] Update `src/modes/patch/run.ts`:
      - On a `kind: "ok"` result, extract `usage`/`cost_usd`/
        `cost_source` from the result. Compute cost via
        `src/prices/cost.ts` when `cost_source` is not `"agent"` and
        `usage` is non-null.
      - Pass these into `writeTelemetry` calls for this iteration.
      - Forward any `result.warnings` through `fanout("harness", ...,
        "stderr")`.
      - Emit the once-per-run "JSON parse mode" notice the first time
        an iteration uses claude with JSON mode enabled.
- [ ] Update `src/telemetry.ts` and the per-iteration call sites in
      `src/modes/patch/run.ts` so the new fields land on the JSONL
      record.
- [ ] Extend `src/config.ts` with the `modes.patch.agents.claude.outputFormat`
      option (default `"json"`), including config validation, defaulting,
      and the corresponding `jarvis config` subcommand if there's a
      pattern the existing config commands follow. If the existing
      `jarvis config` surface has no per-agent option pattern, add the
      field but defer the CLI subcommand to a follow-up; document the
      env-style edit path in `docs/config.md`.
- [ ] Add `test/claude-json.test.ts` covering:
      - Each captured fixture parses without warnings.
      - Truncated-stream fixture returns `displayText = stdout`,
        `usage = null`, populated `warnings`.
      - Tool-call fixture's `displayText` includes the tool name and
        truncated args/results.
      - `total_cost_usd` populates `cost_usd` and triggers `cost_source
        = "agent"` in the agent result wrapper.
- [ ] Add `test/claude-agent.test.ts` (or extend an existing one)
      covering:
      - With `outputFormat: "json"`: argv includes `--output-format
        json`; mock spawn returns a fixture; result has populated
        `usage`.
      - With `outputFormat: "text"`: argv does not include
        `--output-format`; result has no `usage`.
- [ ] Add a `test/run-cost-claude.test.ts` covering the run-loop
      integration: stubbed claude returns a fixture; the resulting
      telemetry record has the expected `usage` and `cost_*` fields.

## Acceptance criteria

- [ ] `claude -p` runs in JSON mode by default and the resulting per-
      iteration telemetry record carries `usage` and `cost_usd` /
      `cost_source` populated by either the envelope or `computeCost`.
- [ ] Truncated or malformed envelopes never crash the run; they fall
      back to raw stdout for display, `usage = null`, and emit a single
      harness warning.
- [ ] `outputFormat: "text"` config option restores legacy behavior
      end-to-end (no JSON parsing, no usage data, streaming-style
      output as before).
- [ ] Captured fixtures are committed under `test/fixtures/claude/`.
- [x] `## Verified envelope` section in this file is populated with the
      observed schema(s).
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes (including all new tests).
- [ ] `bun run check` passes.

## Documentation updates

- [ ] Update `docs/agents.md`'s Claude row to note that JSON output is
      now the default and document the `outputFormat` config option.
- [ ] Update `docs/cost.md` (or the equivalent) to mark Claude as a
      "real usage" agent and Claude's cost source as `"agent"` when the
      envelope provides `total_cost_usd`, otherwise `"computed"`.
- [ ] Update `docs/config.md` with the new
      `modes.patch.agents.claude.outputFormat` option.

## Verified envelope

Verified locally with Claude Code 2.1.142 using a prompt argument:

```sh
claude -p --output-format json 'Reply with exactly: hello'
```

The command requires stdin or a prompt argument; running
`claude -p --output-format json` with no input fails before model
execution with `Error: Input must be provided either through stdin or as
a prompt argument when using --print`.

Captured fixture:
`test/fixtures/claude/2.1.142-simple-prose.json`.

Observed success envelope is a single JSON object with:

- top-level result metadata: `type`, `subtype`, `is_error`,
  `api_error_status`, `duration_ms`, `duration_api_ms`, `ttft_ms`,
  `num_turns`, `result`, `stop_reason`, `session_id`,
  `total_cost_usd`, `terminal_reason`, `fast_mode_state`, `uuid`
- `usage` containing `input_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`, `output_tokens`, `server_tool_use`,
  `service_tier`, `cache_creation`, `inference_geo`, `iterations`,
  and `speed`
- `modelUsage` keyed by model id, with per-model token and cost fields
- `permission_denials` as an array

For the simple prose scenario, `result` contained the display text
directly (`"hello"`), `usage` was populated, and `total_cost_usd` was
populated.
