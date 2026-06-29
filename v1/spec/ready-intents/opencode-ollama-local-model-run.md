---
name: opencode-ollama-local-model-run
---

# opencode drives a local ollama-served model end to end

A patch run configured with `opencode` pointed at a model served by a local
`ollama` server completes a task instead of erroring — the intended v2
terminal local-model fallback (qwen via opencode + ollama).

First establish whether the current failure is harness wiring (opencode
adapter invocation, model/endpoint/provider config against ollama) or
local environment/setup (ollama server not running, model not pulled). Fix
the harness side. If the failure is environment-only, say so and change no
harness code.

Operator-facing setup docs cover configuring opencode + ollama as the
local-model path.

## Prerequisites

- opencode is a wired, selectable v1 patch-mode adapter
- a local ollama server can serve a pulled model on the operator machine
