# createAgent signature cleanup

repo: https://github.com/cbrenner04/jarvis

`createAgent` currently has divergent per-agent branches: claude/codex/cursor spread `{ model }` only when truthy, while opencode/aider throw if `!model`. Only claude receives `opts`. The `!model` branches and the `model ? { model } : {}` spreads are dead because config validation in `src/config.ts` already guarantees `model` is a non-empty, known string by the time the factory is called.

This spec unifies the factory signature to `createAgent(agentName, model: string, opts?)`, collapses the per-agent branches, and drops the resulting dead fallbacks at plan-mode call sites. The `outputFormat` config knob stays exactly where it lives today (`modes.patch.agents.claude.outputFormat`); patch mode keeps resolving it and passing it through `opts.claude.outputFormat`, plan modes keep passing nothing and inheriting the `ClaudeAgent` default of `"json"`. No config schema changes, no user-facing behavior changes.

- [ ] [00 - Tighten createAgent factory signature](./00-tighten-factory-signature.md)
- [ ] [01 - Drop dead model fallbacks at plan-mode call sites](./01-drop-plan-mode-model-fallbacks.md)
