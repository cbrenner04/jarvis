---
name: prompt-rendering-error-names-prompt-id
---

# Prompt-rendering error names the prompt id

A missing-placeholder rendering failure must identify which prompt failed.

## Problem

`shared/prompts/render.ts` throws `Required placeholder \`<SPEC_PATH>\` has no value`.
The operator sees the token but not the prompt, so a failure surfaced through a run
(`run_execution_failed`) gives no way to tell which prompt id was being rendered.

## Behavior

- The `missing_value` `PromptRenderingError` message names the prompt id alongside the
  missing placeholder token.
- The prompt id travels to the error site from the rendering entry point that already
  knows it.

## Documentation updates

- Wherever prompt rendering errors are documented in `v2/docs/` — record the message
  contract (prompt id + token).

## Prerequisites
