# 03 - Aider patch agent

Add `aider` as an opt-in patch-mode agent. This is aimed at local Ollama
models and other models where explicit file lists improve reliability for
one-shot patch tasks. Aider should not be used for plan mode in this spec.

## Decisions

- Add `aider` to the patch agent set, but do not add it to the default agent
  order.
- Use the configured model string directly. For Ollama chat models, users can
  configure values such as `ollama_chat/qwen3.6:35b`.
- Aider should receive the prompt via a temporary message file rather than a
  long positional argument.
- Aider should receive `patchScope.editable` as editable files and
  `patchScope.readOnly` as read-only files.
- If no `Editable` files are listed, fail with a model/config-style error that
  explains aider requires `## Patch scope` with at least one editable file.
  This avoids asking aider to explore the whole repository.
- Jarvis owns commits. Aider must be invoked with auto-commit behavior
  disabled.
- Verify current aider CLI flags before implementation. The intended shape is
  equivalent to:

```sh
aider \
  --model <model> \
  --message-file <tmp-prompt-file> \
  --no-auto-commits \
  --yes-always \
  --file <editable> ... \
  --read <readonly> ...
```

If aider's current CLI uses different flag names, update this subspec with
the verified invocation before coding against it.

## Patch scope

### Editable

- src/agents/aider.ts
- src/agents/types.ts
- src/config.ts
- src/index.ts
- docs/agents.md
- docs/config.md
- docs/quota-signals.md
- test/agents/aider.test.ts
- test/config.test.ts

### Read-only context

- src/agents/opencode.ts
- src/agents/codex.ts
- src/agents/spawn.ts
- test/agents/opencode.test.ts
- spec/completed/2026-05-11-opencode-as-agent/01-opencode-agent-module.md
- spec/completed/2026-05-11-opencode-as-agent/02-config-and-agentname.md

### Out of scope

- Do not make aider a plan-mode agent.
- Do not add aider to the default patch agent order.
- Do not install aider or Ollama.

## Task checklist

- Verify aider's non-interactive flags locally with `aider --help` or
  equivalent documentation before implementation.
- Add an `AiderAgent` class mirroring the existing agent adapter pattern.
- Add `aider` to agent name/config validation and factory wiring.
- Pick a default model string for config bootstrap, but keep aider opt-in.
- Use a temporary prompt file with cleanup after the process exits.
- Pass editable/read-only scope into aider's file arguments.
- Add tests for argv construction, prompt-file use, required editable scope,
  attribution label, and config validation.
- Add quota/model-config signal handling only for known, testable aider
  diagnostics. Otherwise classify failures generically.

## Acceptance criteria

- [ ] `aider` is a valid patch-mode agent name in config and agent factory
      wiring.
- [ ] Default config includes an aider model value for validation/bootstrap
      purposes but does not include aider in the default agent order.
- [ ] `AiderAgent` invokes aider non-interactively with a prompt file.
- [ ] `AiderAgent` disables aider auto-commits.
- [ ] `AiderAgent` maps `PatchScope.editable` and `PatchScope.readOnly` to
      aider file arguments.
- [ ] Running aider without editable scope returns a clear configuration
      error before spawning the process.
- [ ] Unit tests cover argv construction and the missing-scope failure.
- [ ] User-facing agent docs mention aider as opt-in patch-mode only.

## Verification

- Run `bun run typecheck`.
- Run `bun test`.

## Documentation updates

- Update `docs/agents.md` with the aider invocation, opt-in status, and local
  Ollama model example.
- Update `docs/config.md` anywhere supported agent names or sample config are
  enumerated.
- Update `docs/quota-signals.md` only if this subspec adds aider-specific
  quota or model-configuration signals.
