# Wire opencode binding with JSON usage/cost parsing

## Problem

`createResolvedAgentBinding` in `shared/invocation/agents.ts` wires only
`claude`, `codex`, and `cursor`. A resolved `opencode` rung falls through to the
`createUnwiredBinding` branch and returns `kind: "error"`, `exitCode: 127`,
`stderr: "agent 'opencode' ... invocation is not wired yet"`. v2 config,
validation, and machine profiles already accept opencode, so a run with an
opencode agent order spawns nothing and dies at invocation.

Wire opencode as a real agent: build the `opencode run` argv, spawn it through
the existing shared `runAgent` machinery, and parse its `--format json` stream
into token usage and cost.

## Decisions

- argv: `opencode run --dir <cwd> --model <adapterModel> --format json <prompt>`, prompt last positional — matches v1's `opencode.ts` argv order. Rules out reordering flags or passing the prompt on stdin (opencode takes the prompt as a positional).
- stdio `["ignore", "pipe", "pipe"]` — opencode takes the prompt as argv, not stdin, same as cursor. Rules out the pipe-stdin shape claude/codex use.
- classifier: reuse `cursor` quota/model-config pattern set for the shared `AgentName` classifier union rather than adding an opencode-specific set. Rung escalation and quota fallback advance on quota only; a bespoke opencode classifier is out of scope for wiring the binding. Rules out widening the `AgentName` union and porting v1's opencode-specific quota/500 patterns in this subspec.
- usage/cost parsing lives in a new `shared/invocation/opencode-json.ts`, mirroring `cursor-json.ts` placement, parsing `step_finish` `part.tokens.{input,output,cache.read,cache.write}` and `part.cost`, summed across clean steps, plus `text` `part.text` for display. Rules out inlining the parser in `agents.ts`.
- On a successful stream with at least one clean `step_finish`: `usage_source: "agent"`; cost `{ cost_usd, cost_source: "agent" }` when any numeric `part.cost` seen, else `{ cost_usd: null, cost_source: "no-price" }` — mirrors v1 case A. Deferred to first consumer: token-estimation fallback when no clean `step_finish` — pin when a caller needs it; the wiring goal is a real invocation result, and shared has no estimator port. A stream with no clean `step_finish` returns `usage_source: "unavailable"`, `cost_usd: null`, `cost_source: "no-usage"` with a warning, so the run still reports a normal outcome. Rules out reporting `usage_source: "estimated"` (no shared estimator exists).
- display text: rendered `text` parts joined, else raw stdout fallback — mirrors `parseCursorJsonOutput`'s empty-found fallback so a stream that renders nothing does not surface raw NDJSON when text frames exist.

## Tasks

- [ ] Add `shared/invocation/opencode-json.ts` parsing the `--format json` stream into `{ displayText, usage, cost_usd, sawStepFinish, sawAnyCostField }` (summed clean `step_finish` token/cost fields; `text` parts for display).
- [ ] Add an `agentId === "opencode"` branch to `createResolvedAgentBinding` that spawns `opencode run --dir <cwd> --model <adapterModel> --format json <prompt>` via `runAgent` (stdio `["ignore","pipe","pipe"]`, `cursor` classifier) and finalizes the ok result using the new parser.
- [ ] Update the `shared/invocation/agents.test.ts` case so an `opencode` rung is a wired binding (no longer exit 127), and add a spawn-mocked case asserting agent-sourced usage/cost from a `step_finish` stream and the no-`step_finish` unavailable case.
- [ ] Update `v2/docs/shared-invocation.md` to describe the resolved `opencode` binding (argv, JSON parse, ok/quota/model_config/error settlement) alongside claude/codex/cursor, and narrow the "other resolved agents still return the terminal unwired error" sentence.

## Acceptance criteria

- [ ] A resolved `opencode` rung whose `--format json` stdout contains a clean `step_finish` (numeric `part.tokens.{input,output,cache.read,cache.write}` and numeric `part.cost`) settles as `kind: "ok"` with `usage_source: "agent"`, populated `usage`, and `cost_source: "agent"` carrying the summed cost — verified by a new spawn-mocked test in `shared/invocation/agents.test.ts` that fails against the pre-fix exit-127 binding and passes after.
- [ ] A resolved `opencode` rung whose stream has no clean `step_finish` settles as `kind: "ok"` with `usage_source: "unavailable"`, `cost_usd: null`, `cost_source: "no-usage"`, and a warning — verified by a new test that fails against pre-fix code and passes after.
- [ ] The existing `shared/invocation/agents.test.ts` case asserting `opencode` returns `exitCode: 127` "not wired yet" is updated to expect a wired invocation, and no longer asserts the 127 terminal error.
- [ ] Inverting the `agentId === "opencode"` wiring guard (routing opencode back to the unwired branch) makes the new opencode usage/cost test(s) fail — proving the wiring, not the fallthrough, produces the ok result.
- [ ] `binding.id` for the opencode rung is `opencode/<adapterModel>/<priceKey>` and `binding.metadata` is `{ agent: "opencode", model: <adapterModel> }`, unchanged from the pre-fix identity — verified by the updated test.
- [ ] `bun run typecheck` passes.

## Documentation updates

- `v2/docs/shared-invocation.md`: add the resolved `opencode` binding to the bindings list (argv, JSON parse, settlement) and narrow the unwired-agent sentence.
- No `v2/docs/v1-behaviors.md` update: this is net-new v2 wiring; v1's opencode invocation behavior is unchanged.
