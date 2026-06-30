# Shared `--agent` parser

## Problem

`jarvis1 run` and `jarvis1 plan` need the same repeatable `--agent` flag syntax and the same `agentOrder` validation contract as config load. A divergent parser would let one command accept values the other rejects.

## Decisions

- One exported parse/validate helper serves both commands — rules out per-command parsers.
- Parser lives under `v1/src/` (alongside or extracted from `validateAgentOrder` in `config.ts`) — rules out `shared/` placement while validation still depends on v1-only config paths.
- Flag value grammar: `<name>` or `<name>:<model>`; split on the **first** `:` only (e.g. `opencode:provider:model` → agent `opencode`, model `provider:model`) — rules out splitting on every colon.
- Repeatable values build the ladder in argv order — rules out a single-value flag that drops fallback.
- Omitted `:model` inherits the model from the caller-supplied fallback `agentOrder` (configured `modes.patch.agentOrder` or `modes.plan.agentOrder` before override); no matching entry exits non-zero naming the agent and requiring `:model` — rules out agent-CLI default models and rules out requiring `:model` when config already names one.
- Validation matches config `validateAgentOrder`: known agent, non-empty model, no duplicate agent, priced-model check when applicable — rules out a lax CLI bypass.
- Parser returns `AgentEntry[]` or a structured error message; callers prefix with `run:` / `plan:` and exit `1` — rules out throwing through `loadConfig`'s file-scoped errors.
- Extract or share the config `validateAgentOrder` contract for CLI use — rules out a second validator that drifts from config load.

## Task checklist

- Add shared parse helper under `v1/src/` accepting raw `--agent` values plus fallback `agentOrder`.
- Split each value on the first `:` into agent and optional model; resolve omitted model from fallback.
- Run the shared `agentOrder` validation contract on the built ladder.
- Unit-test: valid ladder, duplicate agent, unknown agent, empty model, unknown/unpriced model, omitted-model inherit vs missing fallback entry, first-colon split, `run:` / `plan:` error prefixes.

## Documentation updates

None — parser-only; operator docs land in `02`.

## Acceptance criteria

- [x] Repeatable `--agent` values parse into an `AgentEntry[]` in flag order with the same validation rules as config `agentOrder`.
- [x] `--agent <name>` without `:model` uses the model from the fallback `agentOrder` entry for that agent when present.
- [x] `--agent <name>` without `:model` and no matching fallback entry exits non-zero with a message requiring `:model`.
- [x] Invalid agent, empty model, unknown/unpriced model (when priced), or duplicate agent exits non-zero with an error naming the offending value.
- [x] Values with multiple colons split on the first colon only (agent name before first `:`, remainder is model).
- [x] Callers surface parser errors prefixed with `run:` or `plan:` and exit `1`.
