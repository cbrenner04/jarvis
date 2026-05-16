# 03 - Aider agent (plan + patch)

Add `aider` as an opt-in agent for **`modes.patch`** and **`modes.plan`**.
Patch runs target local Ollama models and similar setups where explicit file
lists improve reliability; plan phases reuse the same adapter with harness-built
scopes (wired in [**06**](./06-plan-mode-aider-wiring.md)).

## Decisions

- Add `aider` to the validated agent-name union so it can appear in
  `modes.patch.agentOrder` and `modes.plan.agentOrder`, but do not add it to either default order.
- Use the configured model string directly. For Ollama chat models, users can
  configure values such as `ollama_chat/qwen3.6:35b`.
- Aider should receive the prompt via a temporary message file rather than a
  long positional argument.
- Aider always receives `patchScope.editable` as editable files and
  `patchScope.readOnly` as read-only files when scope is supplied (patch **and**
  plan phases).
- **Patch mode**: If no non-empty **editable** list is provided after parsing the
  active subspec, fail before spawn with a model/config-style error that explains
  aider requires `## Patch scope` with at least one editable file. This avoids
  asking aider to explore the whole repository.
- **Plan mode**: editable lists come only from the harness (**06**); the adapter
  does not parse Markdown scope for plan iterations.
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

- Do not add aider to default **`modes.patch`** or **`modes.plan`** orders.
- Do not install aider or Ollama.

## Task checklist

- Verify aider's non-interactive flags locally with `aider --help` or
  equivalent documentation before implementation.
- Add an `AiderAgent` class mirroring the existing agent adapter pattern.
- Add `aider` to agent name/config validation and patch-run factory wiring.
  Plan-phase `createAgent` branches live in **06** unless a shared helper is
  introduced earlier without expanding scope beyond these subspecs.
- Pick a default model string for config bootstrap, but keep aider opt-in.
- Use a temporary prompt file with cleanup after the process exits.
- Pass editable/read-only scope into aider's file arguments.
- Add tests for argv construction, prompt-file use, required editable scope,
  attribution label, and config validation.
- Add quota/model-config signal handling only for known, testable aider
  diagnostics. Otherwise classify failures generically.

## Acceptance criteria

- [ ] `aider` is a valid agent name for **`modes.patch`** and **`modes.plan`** in
      config validation.
- [ ] Patch-mode factory wiring can construct `AiderAgent` from `modes.patch`.
      Plan-phase construction is exercised in **06** (may duplicate switch cases until deduped).
- [ ] Default config includes an aider model value for validation/bootstrap
      purposes but does not include aider in default **`modes.patch`** or **`modes.plan`** orders.
- [ ] `AiderAgent` invokes aider non-interactively with a prompt file.
- [ ] `AiderAgent` disables aider auto-commits.
- [ ] `AiderAgent` maps `PatchScope.editable` and `PatchScope.readOnly` to
      aider file arguments.
- [ ] Patch-mode runs using aider without parsed editable scope fail before spawn with a clear configuration error (plan phases supply scope in **06**).
- [ ] Unit tests cover argv construction and the missing-scope failure.
- [ ] User-facing agent docs mention aider as opt-in for **patch** and **plan**
      modes (**05** may consolidate wording).

## Verification

- Run `bun run typecheck`.
- Run `bun test`.

## Documentation updates

- Update `docs/agents.md` with the aider invocation, opt-in status for **both**
  modes, and a local Ollama model example.
- Update `docs/config.md` anywhere supported agent names or sample config are
  enumerated.
- Update `docs/quota-signals.md` only if this subspec adds aider-specific
  quota or model-configuration signals.
