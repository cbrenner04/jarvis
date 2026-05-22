# Aider Model Warnings and Browser Launches

## Overview

When running aider through jarvis, aider occasionally launches a web browser to documentation pages:
- `https://aider.chat/docs/llms/warnings.html`
- `https://docs.litellm.ai/docs/providers`

These browser launches are triggered by LiteLLM (the Python library aider uses for model API access) when it detects certain conditions related to model configuration. The browser launch comes from Python's built-in `webbrowser` module, which aider invokes via LiteLLM.

## Root Cause Analysis

There are three distinct root causes for LiteLLM warnings that trigger browser launches:

### Case 1: Model Naming Mismatch

**Condition**: The model string does not match LiteLLM's expected format.

LiteLLM expects model strings to follow a specific syntax: `provider/model-name`. For example:
- `anthropic/claude-3-5-sonnet`
- `ollama/llama2`
- `openai/gpt-4`

If the model string lacks the provider prefix (e.g., just `claude-3-5-sonnet` instead of `anthropic/claude-3-5-sonnet`), LiteLLM cannot match it against its internal registry. This typically results in:
- A failed aider run (non-zero exit code)
- A `model_config` signal (detected by jarvis's quota patterns like "unknown model" or "model not found")
- Browser launch before failure

**How to identify**: Check jarvis's stderr output for model-related errors like "unknown model", "unsupported model", "invalid model", or similar patterns that match the `modelConfigurationPatterns` in `src/agents/quota.ts`.

### Case 2: Model Not in LiteLLM's Metadata Registry

**Condition**: The model string is correctly formatted and LiteLLM can connect to it, but the model is not in LiteLLM's internal metadata registry (which contains pricing, token limits, and capability information).

This is the most common case when using local models or newer models not yet added to LiteLLM's registry. When this occurs:
- The aider run succeeds (exit code 0)
- LiteLLM emits a warning on every API call about missing model metadata
- The browser is launched by LiteLLM's warning handler

This is **not a configuration error** — it is intentional behavior by LiteLLM to notify developers that it cannot provide pricing/token estimates for the model. The model works fine; LiteLLM just lacks metadata about it.

**How to identify**: The aider run completes successfully but the browser still opens. No errors appear in stderr related to model configuration or connectivity.

### Case 3: Genuine Misconfiguration

**Condition**: LiteLLM cannot reach or authenticate with the model endpoint at all.

This occurs when:
- The provider prefix is wrong (e.g., `ollama` instead of `localhost:11434`)
- The model name does not exist on the provider
- The API endpoint is unreachable
- Authentication credentials are missing or invalid

This typically results in:
- A failed aider run (non-zero exit code)
- An error message about connection failure, missing provider, or authentication
- Browser launch before failure

**How to identify**: Check for connection-related errors in stderr like "could not connect to ollama", "connection refused", "model is not loaded", matching patterns in `aiderModelConfigurationPatterns` in `src/agents/quota.ts`.

## The Solution

The correct approach to prevent browser launches uses two complementary mechanisms:

### 1. `--no-show-model-warnings` Flag

Aider has a built-in flag `--no-show-model-warnings` that **suppresses LiteLLM's warning handler** on successful runs. This is the official, supported mechanism for preventing warnings when your model is not in LiteLLM's registry (Case 2).

This flag does **not** suppress error messages on failed runs, only the metadata-availability warnings on successful ones.

### 2. `BROWSER=false` Environment Variable

Python's `webbrowser` module (which LiteLLM uses internally) reads the `BROWSER` environment variable to determine which browser command to execute. By setting `BROWSER=false`, we provide a command that:
- Exists and is executable on Unix systems
- Exits with code 1 silently (no output)
- Prevents Python from opening a real browser

**Why `false` and not `""`**: An empty string would cause Python to skip the variable and fall back to default browser detection. The `false` command exits with code 1, which Python interprets as "the browser command failed" and suppresses output accordingly.

### Combined Approach

Using both `--no-show-model-warnings` and `BROWSER=false` provides defense-in-depth:
- **Case 1** (naming mismatch): `BROWSER=false` prevents browser launch despite the error
- **Case 2** (missing registry): `--no-show-model-warnings` prevents the warning from being emitted in the first place
- **Case 3** (genuine misconfiguration): `BROWSER=false` prevents browser launch despite the error

This ensures no browser launches occur regardless of the underlying cause, while allowing legitimate error messages to reach stderr for debugging.

## Jarvis Implementation Context

In `src/agents/aider.ts`, the `buildArgv` method constructs the command-line arguments passed to the aider binary. Adding `--no-show-model-warnings` here ensures the flag is always used.

In `src/agents/spawn.ts`, the `runAgent` function creates the environment for the subprocess. Setting `BROWSER=false` in this environment prevents Python's webbrowser module from launching a browser.

Together, these changes suppress browser launches while preserving all error output necessary for diagnosing genuine configuration problems.
