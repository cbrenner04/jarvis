# 00 — Root cause analysis: why aider opens a browser

## Context

When `jarvis run` drives the `aider` agent, aider occasionally opens a browser
to one or both of `https://aider.chat/docs/llms/warnings.html` and
`https://docs.litellm.ai/docs/providers`. These are LiteLLM model-warning
documentation pages that aider opens automatically when LiteLLM emits a warning
about the configured model.

The browser launch comes from inside the `aider` subprocess spawned by
`runAgent` in `src/agents/spawn.ts`. The aider binary itself (via LiteLLM)
calls Python's `webbrowser` module.

## Task checklist

- [ ] Read aider's model-warning documentation (and, if accessible, aider's source)
      to identify all conditions under which LiteLLM triggers the warning that
      causes a browser open.
- [ ] Review `src/agents/quota.ts` `modelConfigurationPatterns` and
      `aiderModelConfigurationPatterns` (lines 50–68) to understand which signal
      categories jarvis already classifies — this is the diagnostic boundary
      between a model that aider can't connect to vs. one that works but emits
      warnings.
- [ ] Review `src/agents/aider.ts` `buildArgv` (lines 56–71) to understand how
      the `--model` flag is constructed. The model value is `this.#model`
      injected at construction time — the code itself does not fix a specific
      model string. Note what format LiteLLM expects (e.g.
      `ollama/llama3`, `anthropic/claude-3-5-sonnet`) and whether model strings
      that lack the provider prefix are the likely trigger for the registry-miss
      warning (case 2).
- [ ] Determine which of the three root cause cases applies (or may apply) for
      a typical jarvis-aider run:
      1. **Model naming mismatch** — the model string doesn't match LiteLLM's
         expected format. Browser opens on failed runs (non-zero exit,
         `model_config` signal). Fix: correct the model string.
      2. **Model not in LiteLLM's metadata registry** — the model works but has
         no pricing/capability metadata. LiteLLM emits a warning on every
         successful call. Browser opens on exit-0 runs. Fix:
         `--no-show-model-warnings` is the correct and intentional resolution.
      3. **Genuine misconfiguration** — LiteLLM can't reach the model at all.
         Browser opens on failed runs. Fix: correct the provider prefix or model
         name.
- [ ] Write findings to `docs/aider-model-warnings.md` covering:
      - What triggers LiteLLM/aider to open a browser.
      - The distinction between the three root cause cases and how to identify
        which one is occurring in a given run.
      - Why the combined `--no-show-model-warnings` + `BROWSER=false` env
        approach (implemented in subspec 01) is the correct fix for case 2, and
        provides a belt-and-suspenders guard for cases 1 and 3 as well.
      - Why `BROWSER=false` (not `BROWSER=""`) is the correct env value: Python's
        `webbrowser` module attempts to execute the value as a command, and
        `false` exits 1 silently on Unix, which suppresses the open without
        side effects.

## Acceptance criteria

- [x] `docs/aider-model-warnings.md` exists and covers all three root cause
      cases with enough detail that a developer can diagnose which case they are
      hitting without consulting external resources.
- [x] The document explains what `--no-show-model-warnings` suppresses and why
      it is the intended aider-supported mechanism (not a workaround).
- [x] The document explains the `BROWSER=false` choice and why `""` is not used.
- [x] `bun run typecheck` passes (no new type errors introduced).
- [x] `bun test` passes (existing tests unaffected by the new doc).

## Documentation updates

The findings document (`docs/aider-model-warnings.md`) created in this subspec
is itself the documentation artifact. No other docs require updates in this
subspec.
