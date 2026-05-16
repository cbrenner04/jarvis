# 02 — Agent model flags

## Problem

After patch-mode model choices exist in config, Jarvis must pass them to the
underlying agent CLIs. The adapters currently only know their binary name and
prompt invocation, so the run command cannot influence model selection.

## Decisions

- Pass the configured patch model into each real agent adapter when building
  default agents for `jarvis run`.
- Keep the `Agent` interface unchanged. Model choice is adapter construction
  config, not a per-call runtime argument.
- Add model options to the real adapters:
  - Claude: `claude -p --model <patchModel>` with prompt on stdin.
  - Codex: `codex exec --model <patchModel>` with prompt on stdin.
  - Cursor: `cursor agent -p --model <patchModel> --workspace <cwd> <prompt>`.
- Do not implement provider or CLI preflight checks for supported models.
- If the underlying CLI reports that the configured model is invalid,
  unavailable, unknown, or unsupported, Jarvis should exit immediately with a
  clear model-configuration message. Do not treat this as quota exhaustion and
  do not fall back to the next agent.
- Fallback to the next agent remains only for quota exhaustion.

## Behavior

Change `defaultAgents` in `src/commands/run.ts` so it accepts the loaded config
or the patch model map and constructs:

```ts
{
  claude: new ClaudeAgent({ model: cfg.patchModels.claude }),
  codex: new CodexAgent({ model: cfg.patchModels.codex }),
  cursor: new CursorAgent({ model: cfg.patchModels.cursor }),
}
```

Tests that inject fake agents through `RunCommandOptions.agents` should continue
to bypass the real adapters.

Each adapter should make the model configurable for tests:

```ts
export type ClaudeAgentOptions = {
  binary?: string;
  model?: string;
};
```

If an adapter is constructed without a model, preserve the old argv behavior.
This keeps unit tests and direct adapter construction flexible.

## Model configuration failures

Jarvis cannot reliably know all supported model aliases ahead of time because
model availability depends on the installed CLI version and the user's account.
Instead, detect unsupported model configuration from the selected agent CLI's
failure output.

Add a model-configuration failure category, either by extending `AgentResult`
or by handling it equivalently in the run loop:

```ts
type AgentResult =
  | { kind: "ok"; stdout: string; stderr: string }
  | { kind: "quota"; stderr: string }
  | { kind: "model_config"; stderr: string }
  | { kind: "error"; exitCode: number; stderr: string };
```

The exact type shape may differ if the implementation keeps the public
interface smaller, but the behavior must be:

- Detect common unsupported-model diagnostics in stderr/stdout before generic
  non-quota error handling.
- Print a message that names the agent and configured model, for example:

  ```text
  claude: configured patch model "haiku" is not supported by this CLI/account
  ```

- Include the CLI diagnostics after the Jarvis message.
- Exit with the existing non-quota agent failure code, `3`.
- Do not remove the agent from the active list and do not invoke another agent.

Initial detection should cover wording such as:

- `unknown model`
- `unsupported model`
- `invalid model`
- `model not found`
- `model is not available`
- `not available for your account`
- `unrecognized model`

Avoid broad matching on words like `rate`, `limit`, `quota`, or
`resource_exhausted`; those remain quota-detection territory.

## Tasks

- [x] Add optional `model` constructor settings to `ClaudeAgent`, `CodexAgent`,
  and `CursorAgent`.
- [x] Include the model flag in each adapter argv when `model` is present.
- [x] Update `defaultAgents` so normal `jarvis run` passes configured
  `patchModels` into the adapters.
- [x] Add unsupported-model detection for selected-agent CLI failures.
- [x] Update the run loop so unsupported model configuration exits 3 without
  falling back to another agent.
- [x] Update adapter tests to assert the default patch-mode argv shape through
  the model option.
- [x] Add tests proving unsupported model diagnostics exit immediately with a
  message naming the agent and model.
- [x] Update run tests if config fixtures need `patchModels`.

## Acceptance criteria

- Normal `jarvis run` constructs real adapters with the loaded config's
  `patchModels`.
- Claude receives `--model haiku` with the default config.
- Codex receives `--model gpt-5.3-codex` with the default config.
- Cursor receives `--model "Composer 2"` with the default config.
- If an agent CLI reports an unsupported configured model, Jarvis exits 3,
  prints a model-configuration message naming the agent and model, and does not
  invoke the next agent.
- Existing fake-agent tests still work without constructing real CLIs.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- None. Documentation is handled by `03-documentation.md`.
