---
name: create-agent-signature-cleanup
---
right now `createAgent` has different signature for claude, opencode, and aider. Additionally, there are model checks for calling each agent constructor. Model should not be undefined ever. Additionally, I am not sure why the ClaudeAgent constructor has the outputFormat check. We should either expect that to live in the config or its just hardcoded in the ClaudeAgent. 

## Interview turn 1

Findings from a read-only pass through the repo:

- **Factory shape** (`src/agents/factory.ts`): `createAgent(agentName, model: string | undefined, opts: { claude?: { outputFormat } } = {})`. Per-case branches diverge: claude/codex/cursor spread `{ model }` only when truthy; opencode and aider throw if `!model`; only claude receives `opts`.
- **Model is in fact always defined.** `src/config.ts:414` validates each agent entry's `model` as a non-empty string during config parsing, and `config.ts:430` further requires it to resolve to a known priced model. By the time call sites in `src/modes/patch/run.ts`, `src/modes/plan/{review,interview,name-only,draft}.ts` invoke the factory with `entry.model`, that value cannot be `undefined`. The runtime `throw` branches for opencode/aider and the `?? "default"` log fallbacks in plan modes are dead code.
- **Per-agent constructor options types** (`ClaudeAgentOptions`, `CodexAgentOptions`, `CursorAgentOptions`, etc.) each declare `model?: string`. Tightening the factory to `model: string` is consistent with config invariants; the agent constructors can either keep `model?` (since tests construct them directly with optional model) or be tightened too — decision point for drafting.
- **outputFormat plumbing.** Only `ClaudeAgent` has `outputFormat`. It is configurable via `modes.patch.agents.claude.outputFormat` (`src/config.ts:468`, getter at `src/config.ts:748`). The factory currently forwards it only when patch-mode passes it in (`src/modes/patch/run.ts:581`); plan-mode call sites never pass it, so plan-mode invocations of claude silently fall through to the constructor default (`"json"`). This means the config knob is effectively patch-only today.
- **Three plausible resolutions for outputFormat**, to choose from in drafting:
  1. Keep it config-driven and have the factory read `cfg` directly (factory takes `cfg`, not separate `opts`), so every mode honors the config consistently.
  2. Remove the per-mode opts plumbing and hardcode `"json"` in `ClaudeAgent` (drop the config field and the patch-mode override). The completed token/cost-tracking spec (`spec/completed/2026-05-16-token-and-cost-tracking/04-claude-json-output-and-usage.md`) added this opt-out deliberately, so dropping it changes user-facing behavior.
  3. Keep current shape but make all call sites pass the same `opts` from config (status quo, just consistent).

Recommended direction (for drafting to consider): unify the factory signature to `createAgent(agentName, model: string, opts?)`, drop the `if (!model) throw` branches and the `model ? { model } : {}` spreads, and either (a) move outputFormat resolution into the factory using config, or (b) require call sites to always pass the resolved outputFormat. The intent's question favors (a), since `outputFormat` already lives in the config.

- **Risks / scope boundaries.**
  - Tests in `test/agents/claude.test.ts` construct `ClaudeAgent` directly with `outputFormat: "text"`; those should be untouched by factory changes.
  - `test/plan-draft-hard-error-continue.test.ts` references `createAgent`; verify expected signature changes.
  - Plan-mode log strings using `entry.model ?? "default"` become just `entry.model` once the invariant is encoded in types.
  - This is a refactor with no user-facing behavior change unless option (2) above is chosen (which would remove a documented config option).

## Interview turn 2

Additional context that affects drafting choices:

- **`getClaudeOutputFormat` is patch-scoped today.** `src/config.ts:748` reads `cfg.modes.patch.agents?.claude.outputFormat` only. There is no `modes.plan.agents.claude.outputFormat` field in the schema. So "option (a) — factory reads from cfg" cannot simply call the existing helper from plan modes; drafting must decide one of:
  - Promote `outputFormat` to a mode-agnostic location (e.g. a top-level `agents.claude.outputFormat`), and have the factory read from there. This is a config schema change.
  - Add a parallel `modes.plan.agents.claude.outputFormat` and have plan call sites resolve+pass it (mirrors current patch plumbing; keeps factory signature with `opts`).
  - Make `outputFormat` not configurable at all (option 2 in turn 1) — removes the field, hardcodes `"json"` in `ClaudeAgent`. Reverses a deliberate decision from the completed token/cost-tracking spec.
- **Plan modes always want JSON.** Plan modes today never pass `outputFormat`, so `ClaudeAgent` defaults to `"json"`. JSON output is what enables token/cost extraction. There is no known reason a plan-mode operator would want plain-text Claude output, so factoring outputFormat resolution through a path that touches plan modes risks accidentally exposing a knob nobody asked for.
- **Recommended factory shape after refactor:**
  ```ts
  createAgent(agentName: AgentName, model: string, opts?: CreateAgentOptions): Agent
  ```
  with all five cases collapsing to `new XAgent({ model, ...maybeClaudeOpts })`. The `if (!model) throw` branches and `model ? { model } : {}` spreads all go away. Per-agent `XAgentOptions.model?: string` can stay optional (tests construct agents directly without model) — only the factory call site is tightened.
- **Recommended answer to the outputFormat question:** keep the existing patch-mode plumbing (factory keeps `opts.claude.outputFormat`, patch passes the resolved config value, plan modes pass nothing and default to json). This answers the intent's "config vs hardcoded" framing as "config, exactly where it already lives" — no schema change, no behavior change. The factory signature unification is independent of and does not require changing outputFormat's home.
- **Call-site cleanups that fall out of the type change:**
  - `src/modes/plan/draft.ts`, `interview.ts`, `name-only.ts`, `review.ts`: `entry.model ?? "default"` log fallbacks become `entry.model`.
  - `src/modes/patch/run.ts:581`: unchanged shape, but `entry.model` is now non-optional in the call.
- **Out of scope (do not bundle):** changing `ClaudeAgent`/`CodexAgent`/etc. constructor option types, altering the config-schema location of `outputFormat`, or removing the outputFormat config knob.
- **Test impact:** `test/plan-draft-hard-error-continue.test.ts` and any test that calls `createAgent` with an explicitly-`undefined` model will need updating; agent constructor tests (`test/agents/claude.test.ts` et al.) are unaffected since they bypass the factory.

## Interview skip

No further refinement applied. Turns 1 and 2 already enumerate the factory signature change, the outputFormat resolution options with a recommended answer, scope boundaries, and test impact — enough for drafting to proceed without additional human input.
