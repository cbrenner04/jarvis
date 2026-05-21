---
name: opencode-real-token-usage
---

# Use opencode's own token accounting instead of estimating

## The problem

Jarvis's opencode agent integration currently estimates token usage from `prompt + stdout` text using the shared tiktoken-based `estimateTokenUsage` helper. See `src/agents/opencode.ts:51-100` — the run argv is `opencode run --dir <cwd> --model <provider/model> --format default <prompt>`, and after the run we feed prompt+stdout into the estimator and set `usage_source: "estimated"`. Cache reads/writes and reasoning tokens are not captured at all, and total counts are imprecise because the estimator doesn't know about provider-side prompt assembly, tool calls, or cache behavior.

Opencode itself already exposes real per-step token usage and cost. Two surfaces:

1. **`opencode run --format json`** emits one JSON object per line to stdout. Every `step_finish` event carries the canonical `tokens` and `cost` for that step, plus `sessionID` and `messageID` on each event. Probed shape (real output):
   ```json
   {"type":"step_finish","timestamp":...,"sessionID":"ses_...","part":{"id":"prt_...","reason":"stop","messageID":"msg_...","sessionID":"ses_...","type":"step-finish","tokens":{"total":24672,"input":3,"output":4,"reasoning":0,"cache":{"write":24665,"read":0}},"cost":0}}
   ```
   Other event types in the stream include `step_start`, `text` (assistant text parts with `part.text`), and tool-related parts. Stdout is JSON-per-line; there is no human-readable rendering by default.

2. **`opencode export <sessionID>`** prints aggregated session JSON (top-level `info.tokens` with `input`/`output`/`reasoning`/`cache.{read,write}` and `info.cost`, plus per-message records with the same shape).

We want to switch to opencode's real numbers. This is a minimal change: the rest of jarvis (telemetry writer, end-of-run summary at `src/run-summary.ts`) already reads `AgentResult.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}` and `cost_usd`/`cost_source`, so opencode just needs to populate those fields with real numbers and `usage_source: "agent"` instead of `"estimated"`.

## The fix (single subspec)

Update `src/agents/opencode.ts` to:

1. **Change the argv** from `--format default` to `--format json` (the only line edit in the argv builder, around `src/agents/opencode.ts:64-65`).
2. **Stream-parse stdout** line by line as JSON. For each line that is a valid JSON object:
   - If `type === "step_finish"` and `part.tokens` is present, accumulate per-step `tokens.input`, `tokens.output`, `tokens.cache.read`, `tokens.cache.write` into running totals, and accumulate `part.cost` into a running cost total.
   - If `type === "text"` and `part.text` is a string, render the text to the caller's stdout pipe as today's default-format transcript would have (so terminal output and session-log readability are preserved).
   - Ignore other event types (`step_start`, tool parts, etc.) for usage purposes, but still consider rendering a brief human-readable line where it materially improves transcript readability (e.g. tool invocations). Keep this conservative — the load-bearing goal is accurate token capture, not transcript fidelity.
   - Lines that fail to parse as JSON (legacy log lines, banners) should pass through to stdout unchanged so we don't drop information.
3. **Populate `AgentResult.usage` from the accumulated totals**, mapped to the existing field names:
   - `input_tokens` ← sum of `tokens.input`
   - `output_tokens` ← sum of `tokens.output`
   - `cache_read_input_tokens` ← sum of `tokens.cache.read`
   - `cache_creation_input_tokens` ← sum of `tokens.cache.write`
   - `reasoning_tokens` does **not** map to any field on `AgentResult.usage` today; do not add a new field — drop reasoning tokens silently on the floor. (Other agents do the same.)
4. **Set `usage_source: "agent"`** and `cost_usd` + `cost_source` from the accumulated cost:
   - When at least one `step_finish` event was observed: `usage_source: "agent"` and `cost_usd: <summed cost>`. If summed cost is `0` and that's because the provider returns `0` (typical for github-copilot models), set `cost_source: "agent"` with `cost_usd: 0` — that's accurate, not missing. If no `cost` field appeared at all on any `step_finish`, set `cost_source: "no-price"` and `cost_usd: null`.
   - When **no** `step_finish` events were observed at all (legacy opencode version, or malformed stream): fall back to the **existing** prompt+stdout estimator path (`usage_source: "estimated"`) so we degrade gracefully on older CLIs. Add a one-time per-run stderr notice via the existing `warnings` field documenting the fallback.
5. **Remove the `estimateTokenUsage`-only success path** for the new shape; keep the estimator import for the fallback path described in (4). The "estimator returns null" branch (current `src/agents/opencode.ts:84-94`) remains as the deepest fallback (`usage_source: "unavailable"`).

The model price-key resolver (`resolveOpencodePriceKey` in `src/agents/opencode.ts:30-34`) and `OPENCODE_HAS_PRICED_MODELS` flag are unchanged. The price-table lookup is still useful when the provider returns `cost: 0` for free-tier models and we want a computed estimate — but DO NOT mix: when opencode reports a real cost, use it. The price-table cost-computation in `extractUsageAndCost` is already the fallback for `cost_source !== "agent"`.

## Constraints

- **Do not add a new `AgentResult.usage` field** for reasoning tokens. Drop them silently. Other agents do this too; adding a new field is a much bigger surface change and out of scope.
- **Do not call `opencode export`** as a second subprocess. The `--format json` stream already contains the canonical numbers; a second subprocess adds a flush race and a process-spawn cost per iteration for no gain.
- **Preserve current terminal/session-log readability for the success case.** A reader of the session log should see roughly the same human-readable transcript they see today for opencode iterations. JSON event noise should not flood the log; only render `text` parts (and any other materially useful events the author decides on, conservatively).
- **Preserve current behavior on failure paths.** Quota detection, model-config detection, and the existing `streamErrorPrefix: "opencode:"` stderr handling are unchanged. The `runAgent` wrapper in `src/agents/spawn.ts` still owns stderr classification and exit-code routing. The new code only changes what happens to **stdout** on `kind === "ok"`.
- **Streaming, not buffering.** The line-by-line parser should render `text` parts as they arrive (so users see progress), not wait for the process to exit and then dump everything at once. The current `runAgent` helper buffers stdout into `result.stdout` for post-hoc parsing; that's fine to keep, but the live render path should hook into the spawn-stage stdout pipe. If wiring live rendering through `runAgent` is more than a small change, the drafter may render in one pass at the end of the run as an acceptable v1 compromise — but call this out explicitly in the subspec's decisions section and add a follow-up checkbox for the live path.

## Tests

- Add tests in `test/agents/opencode.test.ts` covering:
  1. A stdout stream containing two `step_finish` events with non-zero `tokens` and `cost` → `AgentResult.usage` has the summed input/output/cache_read/cache_write, `cost_usd` is the sum, `usage_source === "agent"`, `cost_source === "agent"`.
  2. A stdout stream containing `step_finish` events with `cost: 0` (github-copilot shape) → `cost_usd: 0`, `cost_source: "agent"` (not `"no-price"`).
  3. A stdout stream with no `step_finish` events but parseable text → fall back to `estimateTokenUsage`; `usage_source === "estimated"`; a `warnings` entry mentions the legacy fallback.
  4. A stdout stream where the estimator also returns null → `usage_source === "unavailable"`, `cost_source === "no-usage"` (existing behavior preserved).
  5. A stream mixing valid JSON lines and non-JSON lines (e.g. banner text) → non-JSON lines are forwarded to stdout/log; JSON lines are not double-rendered.
  6. Argv shape test: confirms `--format json` is now passed (replacing the existing `--format default` assertion).

- Update the existing fixture `test/fixtures/opencode/opencode-format-json-command.{stdout,stderr,exit}` (currently empty placeholders) with a small realistic JSON event stream from `opencode run --format json` and use it as the basis for at least one of the tests above. A realistic 3-event sample is fine; the drafter can also probe `opencode run --format json --model github-copilot/claude-haiku-4.5 "say hello"` to capture a real stream.

## Docs to update

- `docs/run-loop.md:332-338` — replace the current "Opencode usage is estimated from prompt/stdout text" paragraph with one describing that opencode usage and cost are now read from `--format json` stream events (`usage_source: "agent"`, `cost_source: "agent"`), with the estimator path retained only as a legacy/fallback. Mention the one-time fallback notice from the existing flag (`opencodeUnavailableNoted` at `src/modes/patch/run.ts:198`); rename/repurpose if appropriate. If renaming, update the gating in `src/modes/patch/run.ts:1020-1041` accordingly.
- `docs/agents.md` — the opencode table row should be updated to say tokens/cost are extracted from `--format json` events.
- `docs/AGENTS.md` (the duplicate companion table) — same update.

## Out of scope

- Adding `reasoning_tokens` to `AgentResult.usage`. Other agents don't have it; this is a wider refactor.
- Calling `opencode export` as a second subprocess. Stream parsing is sufficient.
- Adding a richer transcript renderer for tool-call events. Conservative `text` part rendering is enough for v1.
- Changing how the end-of-run summary in `src/run-summary.ts` renders — the existing renderer already consumes `usage_source: "agent"` cleanly. No changes there.
- Changing `resolveOpencodePriceKey` or the price-table lookup path. Opencode reports its own cost; the price table is the fallback for other agents.

## Refine turn 1

Notes after inspecting the repo to firm up the handoff to drafting. The intent body above is correct; the items below resolve a few ambiguities the drafter would otherwise hit, and pin down a couple of small facts that the wording leaves open.

### Confirmed against the current code

- `src/agents/opencode.ts` is exactly as described (105 lines; argv build at lines 57–68; estimator path at 80–99). The single argv edit is at line 65 (`"default"` → `"json"`).
- `AgentResult` (`src/agents/types.ts`) has the success-case fields the intent claims: `usage_source: "agent" | "estimated" | "unavailable"`, `cost_source: "agent" | "computed" | "estimated" | "no-price" | "no-usage"`, plus `usage` with the four `*_tokens` fields and `warnings: string[]`. There is **no** existing slot for `reasoning_tokens`, confirming the "drop on floor" decision.
- The harness-level one-time notice lives at `src/modes/patch/run.ts:1020-1041` and is gated on `state.opencodeUnavailableNoted` (declared at line 198, initialised at line 268). The fixture directory `test/fixtures/opencode/` already contains `opencode-format-json-command.{stdout,stderr,exit}` as empty placeholders, ready to be populated.

### Decisions to lock in before drafting

1. **Parser location.** Keep the JSON-line parser inside `src/agents/opencode.ts` rather than introducing a new module. The logic is small (accumulators + a switch on `type`) and isolated to one agent. If it grows past ~80 lines, drafting may extract a helper, but the default should be inline.

2. **Live rendering scope (v1).** The intent's "Streaming, not buffering" constraint allows a v1 compromise. Recommend the drafter pick the **post-hoc render path** for v1 because the current `runAgent` in `src/agents/spawn.ts` (lines 104–110) only exposes a buffered `outBuf` to the agent layer via `result.stdout`; there is no callback hook for incremental stdout. Wiring a live hook through `SpawnConfig` would touch every agent. The acceptance criteria should explicitly:
   - Accept a single end-of-run pass over `result.stdout` that renders `text` parts to the caller's stdout (e.g. via `process.stdout.write`, matching how other agents behave).
   - Add a documented follow-up checkbox (unchecked) for the live-streaming path so it isn't lost.

3. **What "render to stdout" actually means.** The opencode agent today doesn't explicitly tee `result.stdout` anywhere; the harness reads `result.stdout` only as part of the `runAgent` return value and the session-log fanout happens via `runAgent`'s buffering. **Verify before drafting:** does `runAgent` currently forward child stdout to the parent's stdout in real time, or only buffer? Reading `src/agents/spawn.ts:104-110` shows it **only buffers** — there is no `child.stdout.pipe(process.stdout)`. That means today, opencode's transcript reaches the user's terminal/session log via whatever `runAgent`'s caller does with `result.stdout` (likely the fanout in `src/modes/patch/run.ts`). The drafter must confirm where today's opencode transcript ends up before rewriting; if it goes through `result.stdout`, the post-hoc render path just needs to replace `result.stdout` in the returned `AgentResult` with the rendered text-only transcript (or leave `result.stdout` as the raw JSON stream and render a *separate* `transcript` string — but `AgentResult` has no `transcript` field, so the former is simpler). **Recommendation:** on success, replace `result.stdout` in the returned object with the human-readable rendering (concatenated `text` parts plus any pass-through non-JSON lines), keeping JSON event noise out of telemetry and session logs. Document this in the subspec's decisions.

4. **Cost-sum precision.** Use plain JS number addition for the cost accumulator. Costs from opencode are small floats (often `0` for copilot, single-digit cents for paid models); float drift is not material at telemetry precision. Do not introduce a decimal library.

5. **What counts as a "valid JSON object" line.** The parser should treat a line as a JSON event only when (a) the line trimmed is non-empty, (b) `JSON.parse` succeeds, and (c) the parsed value is a plain object with a `type` string. Arrays, numbers, strings, and `null` parsed at the top level should be treated as non-JSON pass-through (avoids treating numeric banners or quoted strings as events).

6. **`cost_source: "no-price"` precondition.** The intent says: if no `cost` field appeared on any `step_finish`, set `cost_source: "no-price"`. To make this unambiguous: track a boolean `sawAnyCostField` separately from the cost accumulator. Setting `cost: 0` on a step still counts as "saw a cost field" → `cost_source: "agent"`. Only when **zero** observed `step_finish` events carried a `cost` key do we fall to `"no-price"`. This matters because absent vs. zero are different signals, and the github-copilot path explicitly returns `cost: 0`.

7. **Warning text for the legacy fallback.** Add the warning string to the subspec verbatim so tests can assert on it. Recommended text: `"opencode: no step_finish events in --format json stream; falling back to token estimation."` This pairs with — and does not replace — the existing `"opencode: token estimator unavailable; usage recorded as unavailable."` warning, which still applies in the deepest-fallback branch (estimator returned null).

8. **Harness-side notice rename.** The intent flags `opencodeUnavailableNoted` in `src/modes/patch/run.ts` for possible rename. Recommendation: **do not rename in this subspec.** The flag still correctly gates the `usage_source === "unavailable"` case (deepest fallback). The new `"estimated"` fallback (legacy CLI / no step_finish events) does not need a separate harness-level one-time notice because it surfaces via the per-iteration `warnings` array already rendered by the run loop. Keeping the rename out of scope avoids touching `run.ts` for a cosmetic change.

9. **Tests: keep them pure-function-shaped.** The recommended test style is to extract the parser into an exported function (e.g. `parseOpencodeJsonStream(stdout: string): { usage, cost, costSource, sawStepFinish, sawAnyCostField, renderedText }`) and unit-test it directly with fixture strings. The agent's `run()` integration is already lightly tested by the argv-shape test; the parser is where the real logic lives and where direct unit tests pay back. This also makes test (5) (mixed JSON/non-JSON) trivial.

10. **Fixture content.** A minimal realistic fixture is enough; do not block on capturing a live stream if `opencode` is not available in the sandbox. Three events — one `step_start`, one `text`, one `step_finish` with non-zero `tokens` and `cost: 0` (copilot shape) — covers tests 1/2/5/6 from the intent.

### Risks

- **Provider-shape drift.** The probed `step_finish.part.tokens.cache.{read,write}` shape is the current opencode emission. If a future opencode release changes this nesting, the parser silently records zeros. Mitigation: when `part.tokens` is present but the expected sub-fields are missing or non-numeric, skip the step (don't add `NaN`) and continue. Tests should cover one malformed `step_finish` event in the mixed-events fixture.
- **Stdout flood from a long run.** A long-running opencode iteration emits one JSON line per step plus text events; for a 30-minute run this could be hundreds of KB. The buffered `outBuf` in `runAgent` will hold all of it. This is acceptable (other agents also buffer), but the drafter should not be surprised by larger session logs than today. The post-hoc render path keeps the user-visible transcript size roughly equivalent to today's by stripping JSON noise.
- **`text` part dedup.** Some opencode versions emit incremental `text` parts (deltas) versus full text per part. If deltas, naive concatenation works. If full-text-per-part with the same `part.id` updated over time, naive concatenation would duplicate. Mitigation: render `text` parts in arrival order without deduplication for v1, and document this in the subspec; revisit if real runs show duplication.

### Suggested subspec breakdown

The intent says "single subspec." That is reasonable given the small surface area, but the drafter should consider splitting docs updates into a second subspec if the implementation subspec acceptance criteria list balloons past ~10 items. Default: keep as one subspec with these acceptance-criteria groups:

- argv change + JSON line parser (with exported pure function)
- `AgentResult` population paths (agent / estimated / unavailable) and warning text
- tests (six listed cases + fixture population)
- docs updates (three files)
- follow-up checkbox for live-streaming render path (unchecked)

## Refine turn 2

Tight follow-up to turn 1: one verified fact strengthens the post-hoc render recommendation, and one nit on argv that the drafter would otherwise have to re-discover.

### Verified: where `result.stdout` flows downstream

Turn 1 (decision 3) said "verify where today's opencode transcript ends up." Confirmed by reading `src/modes/patch/run.ts:1062-1068` and `:806-814`, `:1330-1334`:

- After every `runAgent` call, the harness does `fanout("inbound_stdout", result.stdout, null, { iteration, agent })` and `state.latestIterationStdout.push(...splitLines(result.stdout))`. `LogTag` (`src/modes/patch/run.ts:116`, `src/logging.ts:6`) routes `inbound_stdout` to the terminal, the session log under `~/.jarvis/sessions/`, and the local log server.
- `state.latestIterationStdout` is only consumed by `printBoundedTail` at the two stop sites above (max-iterations and no-progress). It is **not** parsed for spec/progress decisions; it is purely a diagnostic tail.

**Consequence for drafting:** the turn 1 recommendation — "on success, replace `result.stdout` in the returned `AgentResult` with the human-readable rendering" — is safe and strictly improves observability today, because:

1. Terminal/session-log/log-server fanout will show rendered `text` parts instead of JSON-per-line noise. (Today opencode emits human-readable default-format text; we're preserving that property after the argv flip.)
2. The bounded-tail diagnostic on stop conditions becomes more readable rather than less.
3. Nothing in `src/modes/patch/run.ts` parses `result.stdout` for control flow, so swapping the string contents cannot accidentally change spec-completion or progress decisions.

The drafter should still keep the raw JSON stream alive **inside** the parser long enough to extract usage/cost before the agent layer returns. The mutation is just on the returned `AgentResult.stdout` field — not on the buffered child output the parser reads.

### Argv builder nit

`buildArgv` in `src/agents/opencode.ts:57-68` is invoked by `runAgent` with the prompt as the first argument (see `src/agents/spawn.ts:13,25`) but the current implementation interpolates the outer-scope `prompt` parameter from the `run()` method, not the inner `prompt` arg from the closure. Both refer to the same string in practice, so there is no behavioral bug; but when the drafter touches this function (single-line `"default"` → `"json"` edit), they should not "tidy" the unused-looking inner `prompt` param, because the `SpawnConfig.buildArgv` type requires that signature. Leave the signature alone.

### Confirmed: no additional consumers of opencode stdout shape

Searched the repo for downstream parsers of opencode's stdout shape (other than the agent's own estimator path). None exist. `src/run-summary.ts` and the telemetry writer (`writeTelemetry` in `src/modes/patch/run.ts`) consume only `AgentResult.usage` / `cost_usd` / `cost_source` / `usage_source` — not the raw stdout text. Confirms the intent's claim that this is a leaf-level change.

### One additional acceptance-criterion to lift into the subspec

Turn 1's risk on "malformed `step_finish`" should become a testable acceptance criterion, not just a risk note:

- A `step_finish` event whose `part.tokens` is present but missing `tokens.input` (or where the sub-field is non-numeric) is **skipped for accumulation** and **does not contribute zeros or NaN**; the run still treats the stream as having seen `step_finish` events for the purposes of source selection if at least one other `step_finish` parsed cleanly.
- If **every** `step_finish` is malformed, treat the run as if no `step_finish` was observed (fall through to the estimator path with the legacy-fallback warning). This keeps the agent vs. estimated decision binary and easy to reason about.

### No further refinement expected

Turn 1 plus this confirmation cover the unknowns the drafter would otherwise hit. The remaining one turn in the budget should be left unused unless drafting later surfaces a new ambiguity.

## Refine skip

Turn 2 explicitly recommended leaving the final turn unused absent a new ambiguity, and none has surfaced (no drafting has occurred between turn 2 and this turn). The intent body, decisions in turn 1, and verifications in turn 2 already pin down: argv edit location, parser location and exported-function shape, post-hoc render strategy (with confirmed-safe `result.stdout` mutation and follow-up checkbox for live streaming), valid-JSON-line definition, `sawAnyCostField` vs. cost-sum distinction for `no-price` selection, exact warning text, malformed-`step_finish` handling lifted to acceptance criterion, scope of `opencodeUnavailableNoted` (do not rename), reasoning-token drop, fixture minimums, and the docs list. Adding speculative notes would risk overconstraining the drafter. No refinement applied this turn.

## Blocker

Review and approve `spec/2026-05-21T19-02-15Z-opencode-real-token-usage/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis plan --resume-draft spec/2026-05-21T19-02-15Z-opencode-real-token-usage/intent.md`
