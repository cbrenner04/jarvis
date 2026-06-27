# Agent cascade advances past a `model_config` result (don't halt the chain)

## Problem

A `jarvis1 intent` (and any plan-mode split) aborts the whole `agentOrder`
cascade when one agent's failure is classified `model_config`. Observed
2026-06-27: codex (primary for intents) was usage-limited, but its stderr also
carried a shell-snapshot validation error
(`shell_snapshot validation failed … syntax error near unexpected token '('`).
That noise matched a config-error signature, and because `spawn.ts` classifies
in the order transient → auth → **model_config → quota**, the genuine
usage-limit quota signal was masked: the result came back `model_config`. The
cascade then refused to fall through to cursor/claude and exited 3 with
`intent: model configuration error`. Four sibling intents that same minute hit
a *clean* codex quota signal, classified `quota`, advanced to cursor, and
succeeded — so the only difference was the incidental snapshot noise.

Root cause is `v1/src/modes/plan/intent-split.ts`:

```ts
shouldAdvance: (result) => result.kind === "quota" || result.kind === "error",
```

`model_config` is excluded, so it is terminal for the chain.

## Decisions

- A per-agent-environment failure (codex's shell-snapshot error) is
  agent-specific — the next agent in `agentOrder` (a different binary/model)
  would not share it, so the cascade should try it. Decide whether `model_config`
  should advance: advancing is correct for agent-specific config/env errors but
  wasteful for a truly invalid model name that every agent rejects identically.
  Resolve by either (a) advancing on `model_config` like `error`, or (b)
  splitting agent-specific env errors out of `model_config` so only genuine
  bad-model-name halts.
- Classification precedence (`spawn.ts`): when stderr carries BOTH a real quota
  signal and incidental config-error-looking noise, the quota signal should win
  (or model_config should be narrowed) so a usage-limit is not masked. Decide
  which fix is load-bearing — narrowing the model_config patterns, reordering
  quota before model_config, or both.
- Mirror the chosen `shouldAdvance` policy across the other split/cascade call
  sites (patch/review/prompt agentOrder), not just intent-split, so behavior is
  consistent.

Out of scope: fixing the operator's shell rc syntax error that triggers codex's
snapshot warning (operator-env, not harness) — the harness must degrade
correctly regardless of that noise.

## Documentation updates

- Update `v1/docs/quota-signals.md` (and `agents.md` if it documents fallback
  order) to state how `model_config` interacts with the cascade.
- If cascade behavior changes, note it in `v2/docs/v1-behaviors.md`.
