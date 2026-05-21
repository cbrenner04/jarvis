# 00 - Read tokens and cost from `opencode run --format json` stream

## Problem

`src/agents/opencode.ts` currently runs opencode with `--format default` and
estimates token usage by feeding `prompt + stdout` text through the shared
tiktoken-based `estimateTokenUsage` helper. That produces imprecise totals
(it cannot account for provider-side prompt assembly, tool calls, or cache
behavior) and never captures cache reads/writes or reasoning tokens.

Opencode already exposes real per-step token usage and cost. With
`--format json`, opencode emits one JSON object per line to stdout. Each
`step_finish` event carries the canonical numbers for that step:

```json
{"type":"step_finish","timestamp":...,"sessionID":"ses_...",
 "part":{"id":"prt_...","reason":"stop","messageID":"msg_...","sessionID":"ses_...",
         "type":"step-finish",
         "tokens":{"total":24672,"input":3,"output":4,"reasoning":0,
                   "cache":{"write":24665,"read":0}},
         "cost":0}}
```

Other event types in the stream include `step_start`, `text` (assistant text
parts with `part.text`), and tool-related parts.

The rest of jarvis already consumes
`AgentResult.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`
plus `cost_usd`/`cost_source`/`usage_source`. The fix is a leaf-level change
inside `src/agents/opencode.ts`: switch the argv flag, parse the JSON stream,
and populate the existing `AgentResult` fields with real numbers.

## Decisions

These were locked in during refinement; restated here so this subspec is
self-contained.

1. **Parser lives in `src/agents/opencode.ts`.** Do not introduce a new
   module. Export the parser as a pure function (suggested:
   `parseOpencodeJsonStream(stdout: string)`) returning at minimum
   `{ usage, costUsd, sawStepFinish, sawAnyCostField, renderedText, warnings }`,
   so it can be unit-tested directly with fixture strings.

2. **Post-hoc render path for v1.** `runAgent` in `src/agents/spawn.ts:104-110`
   only buffers child stdout into `outBuf`; it exposes no incremental callback.
   Do not wire a live-streaming hook through `SpawnConfig` in this subspec.
   Render `text` parts to a single human-readable transcript string after the
   process exits, and **mutate the returned `AgentResult.stdout`** to that
   rendered transcript (concatenated `text` parts plus any non-JSON
   pass-through lines, in arrival order). Verified safe: `src/run-summary.ts`
   and `writeTelemetry` consume only `AgentResult.usage`/`cost_usd`/
   `cost_source`/`usage_source`; the harness fanout
   (`src/modes/patch/run.ts:1062-1068`) routes `result.stdout` to terminal,
   session log, and log server only; `state.latestIterationStdout` is used
   only by `printBoundedTail` for diagnostic stop tails
   (`src/modes/patch/run.ts:806-814,1330-1334`). No control-flow decision
   reads the stdout string. Add an unchecked follow-up checkbox below for
   the live-streaming path.

3. **Valid JSON event line definition.** A stdout line counts as a JSON event
   only when (a) trimmed line is non-empty, (b) `JSON.parse` succeeds, and
   (c) the parsed value is a plain object with a string `type` field. Arrays,
   numbers, strings, or `null` at the top level are pass-through. Any line
   that fails parse is pass-through.

4. **`sawAnyCostField` is distinct from cost sum.** Track separately whether
   any observed `step_finish` event carried a `cost` key. `cost: 0` still
   counts as "saw a cost field" → `cost_source: "agent"`, `cost_usd: 0`.
   Only when zero observed `step_finish` events carried a `cost` key do we
   set `cost_source: "no-price"` and `cost_usd: null`. This matters because
   github-copilot models legitimately emit `cost: 0`.

5. **Malformed `step_finish` handling.** When `part.tokens` is present but
   any of `tokens.input`, `tokens.output`, `tokens.cache.read`,
   `tokens.cache.write` is missing or non-numeric, skip that step entirely
   (do not add zeros or NaN). The step still counts as "seen" for the
   source-selection decision **only if** at least one other `step_finish`
   parsed cleanly. If every `step_finish` is malformed, treat the run as if
   no `step_finish` was observed and fall through to the legacy-fallback
   estimator path.

6. **Reasoning tokens are dropped silently.** `AgentResult.usage` has no
   `reasoning_tokens` field. Do not add one in this subspec — other agents
   drop reasoning tokens too; adding the field is a wider surface change
   and explicitly out of scope.

7. **Cost accumulator uses plain JS number addition.** Do not introduce a
   decimal library. Float drift at telemetry precision is not material.

8. **Do not call `opencode export`.** The `--format json` stream already
   contains the canonical numbers; a second subprocess would add a flush
   race and per-iteration process-spawn cost for no gain.

9. **Do not rename `opencodeUnavailableNoted`** in `src/modes/patch/run.ts`
   (declared at `:198`, gated at `:1020-1041`). It still correctly gates the
   `usage_source === "unavailable"` deepest-fallback path. The new legacy
   fallback (`usage_source === "estimated"` when no `step_finish` was
   observed) surfaces through the per-iteration `warnings` array the run
   loop already renders.

10. **Argv `buildArgv` signature is unchanged.** The function lives at
    `src/agents/opencode.ts:57-68` and uses the outer-scope `prompt` rather
    than the inner closure arg. That is fine; `SpawnConfig.buildArgv`
    requires the inner-arg signature. Do not "tidy" it.

## Implementation outline

1. **Argv flip** (`src/agents/opencode.ts:64-65`): change `"default"` to
   `"json"` in the `--format` arg. This is the only argv edit.

2. **Add exported parser** in `src/agents/opencode.ts`:

   ```ts
   export function parseOpencodeJsonStream(stdout: string): {
     usage: {
       input_tokens: number;
       output_tokens: number;
       cache_read_input_tokens: number;
       cache_creation_input_tokens: number;
     };
     costUsd: number;
     sawStepFinish: boolean;
     sawAnyCostField: boolean;
     renderedText: string;
     warnings: string[];
   };
   ```

   - Split `stdout` on newlines.
   - For each line: trim, attempt `JSON.parse`, check plain-object-with-string-`type`.
   - On `type === "step_finish"`: validate `part.tokens.input/output/cache.read/cache.write` are numbers; if any required token field is missing or non-numeric, mark the step malformed and continue without accumulating. If clean, add to the four accumulators. If `part.cost` is a number, add to cost accumulator and set `sawAnyCostField = true`. Set `sawStepFinish = true` only when the step accumulated cleanly.
   - On `type === "text"` with string `part.text`: append `part.text` to `renderedText` in arrival order without dedup (deltas vs. full-text-per-part TBD; document as v1 limitation in code comment).
   - On any other event type (`step_start`, tool parts, etc.): no rendering, no accumulation.
   - On non-JSON or non-event lines: append the original line (with trailing newline) to `renderedText` as pass-through so banners and legacy log lines survive.

3. **Wire usage/cost in the `run()` success path** (`src/agents/opencode.ts:80-99` today; there is **no** `extractUsageAndCost` function in `opencode.ts` — the intent's phrasing was loose. The mapping into `AgentResult` happens inline in `run()` after `runAgent` returns `kind: "ok"`. Replace that block with the three cases below):

   - Call `parseOpencodeJsonStream(result.stdout)`.
   - **Case A — `sawStepFinish` true**:
     - `usage = { ...parsed.usage }`, `usage_source = "agent"`.
     - If `sawAnyCostField` true: `cost_usd = parsed.costUsd`, `cost_source = "agent"`.
     - Else (no `cost` field on any `step_finish`): `cost_usd = null`, `cost_source = "no-price"`.
     - **Enrichment interaction (important).** `src/telemetry-enrichment.ts:37-87` does **not** read `AgentResult.cost_source`; it re-derives output `cost_source` from `usage_source` and `cost_usd`. The mapping that matters:
       - `cost_usd` is any number (including `0`) → enrichment sets `cost_source: "agent"` (line 52-59). The `cost: 0` github-copilot path is preserved end-to-end.
       - `cost_usd` is `null` and `usage` is present → enrichment uses `resolveOpencodePriceKey(model)` (which returns the model string, never `null` while a model is configured) and attempts a price-table compute. If the model has a rate, enrichment overwrites with `cost_source: "computed"`; if not, with `cost_source: "no-price"`.
       - Consequence: in the `sawAnyCostField === false` sub-case, the agent's `cost_source: "no-price"` on `AgentResult` is a best-effort signal that is **only authoritative when the model is unpriced**. When it is priced, downstream telemetry will (correctly) show `"computed"`. Agent-level tests should assert against the agent's returned `AgentResult` directly (where `"no-price"` is what the agent emits); end-to-end telemetry-level assertions are out of scope for this subspec.
   - **Case B — `sawStepFinish` false, estimator returns usage**:
     - Use `estimateTokenUsage(prompt, result.stdout)` as today; `usage = estimated`, `usage_source = "estimated"`.
     - Do **not** set `cost_usd` or `cost_source` on the returned `AgentResult`. Downstream enrichment (`src/telemetry-enrichment.ts:62-83`) reads `usage` plus the price key from `resolveOpencodePriceKey` and fills in `cost_usd` + `cost_source` (`"estimated"` when a rate exists and `usage_source === "estimated"`, `"no-price"` otherwise). This matches today's behavior exactly — opencode.ts's current estimator success path also does not set cost fields directly.
     - Append warning: `"opencode: no step_finish events in --format json stream; falling back to token estimation."`.
   - **Case C — `sawStepFinish` false, estimator returns null**:
     - `usage_source = "unavailable"`, `cost_source = "no-usage"` (existing behavior, unchanged).
     - The existing `warnings` entry (`"opencode: token estimator unavailable; usage recorded as unavailable."`) still applies.

4. **Mutate returned `AgentResult.stdout`** to `parsed.renderedText` on the
   success path (Case A and Case B). This keeps JSON event noise out of
   terminal, session log, and log server fanout.

5. **Keep the estimator import.** It is still used in Cases B and C.

6. **Do not change**: `resolveOpencodePriceKey`, `OPENCODE_HAS_PRICED_MODELS`,
   `streamErrorPrefix: "opencode:"`, quota/model-config detection, exit-code
   routing, or anything in `src/agents/spawn.ts`.

## Tests

Add tests in `test/agents/opencode.test.ts`:

1. **Two `step_finish` events, non-zero tokens and cost.** Build a stdout
   string with two `step_finish` lines carrying real numbers. Assert
   `AgentResult.usage` has the summed `input_tokens`, `output_tokens`,
   `cache_read_input_tokens`, `cache_creation_input_tokens`; `cost_usd`
   equals the sum; `usage_source === "agent"`; `cost_source === "agent"`.

2. **`cost: 0` shape (github-copilot path).** Stdout with `step_finish`
   events whose `cost: 0`. Assert `cost_usd === 0`, `cost_source === "agent"`
   (NOT `"no-price"`).

3. **No `step_finish` events but parseable text.** Stdout with only `text`
   parts. Assert fallback to `estimateTokenUsage`, `usage_source === "estimated"`,
   the agent does not set `cost_usd` or `cost_source` directly, and
   `warnings` contains exactly:
   `"opencode: no step_finish events in --format json stream; falling back to token estimation."`.

4. **Estimator also returns null.** Stub or arrange so `estimateTokenUsage`
   returns null. Assert `usage_source === "unavailable"`,
   `cost_source === "no-usage"` (existing behavior preserved).

5. **Mixed JSON and non-JSON lines.** Stream interleaves valid JSON event
   lines with banner / legacy log lines. Assert non-JSON lines appear in the
   rendered transcript (mutated `result.stdout`); JSON event lines do **not**
   appear verbatim in the rendered transcript (only their `text` parts do);
   usage accumulation is unaffected by the non-JSON lines.

6. **Argv shape.** Assert `--format json` is in the built argv (replacing
   the previous `--format default` assertion).

7. **Malformed `step_finish` events.** A stream containing one clean
   `step_finish` and one malformed `step_finish` (missing `tokens.input`)
   accumulates only the clean step and still returns `usage_source === "agent"`.
   A stream containing only malformed `step_finish` events falls through to
   the estimator path (`usage_source === "estimated"`) with the legacy-fallback
   warning.

Tests 1, 2, 5, and 7 may share the same underlying fixture by composing event
lines from helper builders, or by populating
`test/fixtures/opencode/opencode-format-json-command.{stdout,stderr,exit}`
with a small realistic stream (`step_start`, `text`, `step_finish` with
non-zero tokens and `cost: 0`) and reusing it. A real-stream probe via
`opencode run --format json --model github-copilot/claude-haiku-4.5 "say hello"`
is acceptable but not required.

Where possible, write tests against the exported `parseOpencodeJsonStream`
directly. The agent's `run()` integration is still exercised by the argv-shape
test plus at least one end-to-end test that drives `OpencodeAgent.run()` end
to end (e.g. via the existing fixture-driven test harness pattern in
`test/agents/opencode.test.ts`) so the mapping from the parser output into
`AgentResult` fields is covered.

## Documentation updates

- `docs/run-loop.md:332-338`: replace the "Opencode usage is estimated from
  prompt/stdout text" paragraph with one describing that opencode usage and
  cost are now read from `--format json` stream events
  (`usage_source: "agent"`, `cost_source: "agent"`), with the estimator path
  retained only as a legacy/fallback. Note the per-iteration `warnings`
  entry on the legacy fallback. Mention that the existing
  `opencodeUnavailableNoted` one-time stderr notice
  (`src/modes/patch/run.ts:1020-1041`) still gates only the deepest-fallback
  `usage_source === "unavailable"` branch and is **not** renamed.
- `docs/agents.md`: update the opencode table row so its tokens/cost column
  states they are extracted from `--format json` stream events
  (`step_finish.part.tokens` and `step_finish.part.cost`).
- `docs/AGENTS.md`: same update to the duplicate companion table.

## Acceptance criteria

- [ ] `src/agents/opencode.ts` argv passes `--format json` (not `--format default`).
- [ ] `src/agents/opencode.ts` exports a pure function (suggested name `parseOpencodeJsonStream`) that takes a stdout string and returns at minimum `{ usage, costUsd, sawStepFinish, sawAnyCostField, renderedText, warnings }`.
- [ ] The parser treats a line as a JSON event only when the trimmed line is non-empty, `JSON.parse` succeeds, and the parsed value is a plain object with a string `type` field. Arrays/numbers/strings/`null` at the top level and parse failures are pass-through.
- [ ] On `type === "step_finish"` with valid numeric `part.tokens.input/output/cache.read/cache.write`, the parser accumulates `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` into running totals using the existing `AgentResult.usage` field names.
- [ ] On `type === "step_finish"` where `part.tokens` is present but any required sub-field is missing or non-numeric, the step is skipped (no zeros, no NaN added). If every `step_finish` is malformed, the run is treated as if no `step_finish` was observed.
- [ ] When `part.cost` is a number on a `step_finish` event, it is added to a cost accumulator, and `sawAnyCostField` is set true. `sawAnyCostField` is distinct from "cost sum is non-zero".
- [ ] `reasoning_tokens` are not added to `AgentResult.usage`; no new field is introduced.
- [ ] On `type === "text"` with a string `part.text`, the parser appends `part.text` to a rendered transcript in arrival order without dedup.
- [ ] Other event types (`step_start`, tool parts) are ignored for usage and rendering purposes.
- [ ] Non-JSON / non-event lines are forwarded into the rendered transcript so banners and legacy log lines survive.
- [ ] When at least one `step_finish` accumulated cleanly: `AgentResult.usage_source === "agent"`. When `sawAnyCostField` is true: `AgentResult.cost_usd` equals the summed cost and `AgentResult.cost_source === "agent"` (including the `cost: 0` case). When `sawAnyCostField` is false: `AgentResult.cost_usd === null` and `AgentResult.cost_source === "no-price"`. (Assertions are against the agent-returned `AgentResult` before `src/telemetry-enrichment.ts` runs; downstream enrichment may overwrite `cost_source` to `"computed"` when `cost_usd === null` and a price-table rate exists for the model.)
- [ ] When no `step_finish` was observed (or all were malformed) and `estimateTokenUsage` returns usage: `AgentResult.usage` is set from the estimator, `AgentResult.usage_source === "estimated"`, the agent does **not** set `cost_usd` or `cost_source` (downstream `src/telemetry-enrichment.ts` fills them via the price table), and `AgentResult.warnings` contains exactly `"opencode: no step_finish events in --format json stream; falling back to token estimation."`.
- [ ] When no `step_finish` was observed and `estimateTokenUsage` returns null: `AgentResult.usage_source === "unavailable"` and `AgentResult.cost_source === "no-usage"` (existing behavior preserved).
- [ ] On the success path (Case A and Case B above), the returned `AgentResult.stdout` is replaced with the rendered transcript (concatenated `text` parts plus pass-through non-JSON lines). Raw JSON event lines do not appear verbatim in the returned `AgentResult.stdout`.
- [ ] `resolveOpencodePriceKey`, `OPENCODE_HAS_PRICED_MODELS`, `streamErrorPrefix: "opencode:"`, quota detection, model-config detection, and exit-code routing in `src/agents/spawn.ts` are unchanged.
- [ ] `opencodeUnavailableNoted` in `src/modes/patch/run.ts` is not renamed; its gating at `:1020-1041` is unchanged.
- [ ] The `buildArgv` signature in `src/agents/opencode.ts` is unchanged.
- [ ] Test added: stdout stream with two `step_finish` events carrying non-zero tokens and cost yields summed usage, summed `cost_usd`, `usage_source === "agent"`, `cost_source === "agent"`.
- [ ] Test added: stdout stream with `step_finish` events carrying `cost: 0` yields `cost_usd === 0` and `cost_source === "agent"` (not `"no-price"`).
- [ ] Test added: stdout stream with no `step_finish` events but parseable text falls back to `estimateTokenUsage`; `usage_source === "estimated"`; `warnings` contains the exact legacy-fallback string.
- [ ] Test added: when the estimator also returns null, `usage_source === "unavailable"` and `cost_source === "no-usage"`.
- [ ] Test added: mixed JSON and non-JSON line stream — non-JSON lines appear in the rendered transcript; JSON event lines do not appear verbatim; only `text` parts contribute rendered content from events.
- [ ] Test added: argv builder produces `--format json` (replaces the prior `--format default` assertion).
- [ ] Test added: a malformed `step_finish` event is skipped without breaking accumulation of clean steps; a stream where every `step_finish` is malformed falls through to the estimator path with the legacy-fallback warning.
- [ ] `test/fixtures/opencode/opencode-format-json-command.{stdout,stderr,exit}` is populated with a small realistic JSON event stream (at minimum: `step_start`, `text`, `step_finish` with non-zero tokens and `cost: 0`) and used by at least one of the tests above.
- [ ] `docs/run-loop.md:332-338` updated to describe `--format json` stream-event extraction, the legacy estimator fallback with its per-iteration warning, and the unchanged `opencodeUnavailableNoted` gating.
- [ ] `docs/agents.md` opencode row updated to state tokens/cost are extracted from `--format json` stream events.
- [ ] `docs/AGENTS.md` opencode row updated to match `docs/agents.md`.
- [ ] Follow-up checkbox (intentionally unchecked, do not tick in this subspec): wire live-streaming render through `SpawnConfig` so `text` parts render incrementally as opencode emits them, instead of the v1 post-hoc single-pass render.
