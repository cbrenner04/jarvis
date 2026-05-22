# 01 — Agents, models, pricing keys, and quota fallback

## Problem

The catalog needs a complete source-backed account of how v1 chooses, launches,
and falls back across agent CLIs. The intent requires coverage of all five
adapters, not just the default order, and this area also owns user-observable
stderr messages and cost-model behavior that later v2 work must preserve or
consciously change.

## Scope

Fully author the `## Agent adapters, model selection, and quota fallback`
section in `v2/spec/v1-behaviors.md`.

Add entries to `## Behaviors with uncertain intent` only when this audit finds
real ambiguity about an observable agent behavior that cannot be resolved from
source.

## Primary sources

- `v1/src/agents/`
- `v1/src/agents/types.ts`
- `v1/src/agents/factory.ts`
- `v1/src/agents/spawn.ts`
- `v1/src/agents/quota.ts`
- `v1/src/agents/token-estimation.ts`
- `v1/src/agents/price-keys.ts`
- `v1/src/quota-harness-messages.ts`
- `v1/docs/agents.md`
- `v1/docs/quota-signals.md`
- `v1/docs/aider-model-warnings.md`

## Task checklist

- [ ] Audit the five real adapters and catalog all user-observable behavior for
      `claude`, `codex`, `cursor`, `opencode`, and `aider`.
- [ ] Exclude `claude-json.ts`, `codex-session.ts`, and `cursor-tokens.ts` as
      standalone catalog subjects unless they surface as observable behavior
      such as session-file side effects, parsing-sensitive failure modes, or
      token accounting differences.
- [ ] Document default and configurable agent order, model selection behavior,
      any adapter-specific warnings or constraints, and the way price keys or
      estimation logic become visible in usage/cost reporting.
- [ ] Capture quota detection and fallback behavior, including strict versus
      fallback-eligible outcomes, shared harness stderr strings, and the
      operator-visible all-agents-exhausted case.
- [ ] Record process-lifecycle behavior from `v1/src/agents/spawn.ts` that a
      user can observe, including Ctrl-C/abort shutdown semantics and the
      detached process-group kill behavior.
- [ ] Mark only genuinely ambiguous agent behaviors with `[uncertain]`, naming
      the missing signal or contradiction that prevents a stronger statement.

## Acceptance criteria

- [ ] `v2/spec/v1-behaviors.md` contains a substantive `## Agent adapters,
      model selection, and quota fallback` section covering all five adapters:
      `claude`, `codex`, `cursor`, `opencode`, and `aider`.
- [ ] The section describes observable fallback behavior, quota classification,
      and the shared operator-facing stderr messages from
      `v1/src/quota-harness-messages.ts`.
- [ ] The section captures user-visible model/pricing behavior, including where
      exact usage is available versus estimated and where adapter-specific
      warnings or session artifacts matter to operators.
- [ ] Every behavior entry added by this subspec cites at least one supporting
      source file.
- [ ] Any ambiguity called out by this subspec is tagged `[uncertain]` and
      includes a brief explanation of the unresolved evidence gap.

## Documentation updates

- [ ] `v2/spec/v1-behaviors.md` is updated for the agent, model, pricing, and
      quota-fallback behavior area owned by this subspec.
