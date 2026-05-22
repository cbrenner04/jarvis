# Intent: Stop aider from launching a browser during `jarvis run`

## What's happening

When `jarvis run` drives the `aider` agent, aider opens a browser window to one or both of:

- `https://aider.chat/docs/llms/warnings.html`
- `https://docs.litellm.ai/docs/providers`

These are aider's LLM-warning documentation pages. Aider uses LiteLLM under the hood for multi-provider support; when LiteLLM doesn't recognise the configured model or encounters model-capability warnings, aider opens a browser to explain what's wrong. This is aider's built-in behaviour, not something jarvis is doing directly — the browser launch comes out of the subprocess that `runAgent` spawns in `src/agents/spawn.ts`.

The user has not seen this happen in `jarvis plan`. That's probably because plan mode doesn't delegate to aider, or the aider invocation there uses a different code path.

Not related to token stats: `src/agents/token-estimation.ts` uses `js-tiktoken` locally and `src/prices/load.ts` reads a bundled `data/prices.json` file — neither makes network calls or opens a browser.

## Where to look

- `src/agents/aider.ts` — the `buildArgv` function at lines 56-71 is where aider CLI flags are assembled. This is the right place to suppress the browser behaviour.
- `src/agents/spawn.ts` — spawns the subprocess; env vars could also be injected here or at the aider-specific call site.

## How to fix it

Aider has a flag `--no-show-model-warnings` that suppresses the warnings (and the resulting browser open). Adding that flag to the `buildArgv` array in `AiderAgent.run` is the minimal fix.

There may also be a belt-and-suspenders approach: set `BROWSER=` (empty string) in the subprocess env so that even if aider tries to open a browser via the `webbrowser` Python module or `open`/`xdg-open`, the OS doesn't act on it. This is a broader guard that would survive aider updating the flag name or adding new browser-open sites.

The cleanest fix is probably both: add `--no-show-model-warnings` as a default flag and also set `BROWSER=` in the env passed to the aider subprocess.

Worth checking whether `--no-stream` (already present) or `--yes-always` interacts with warning display in any way — this is a non-interactive run, so any interactive prompt or browser pop-up is always wrong regardless.

## Scope

- Change is confined to `src/agents/aider.ts` (flag) and possibly `src/agents/spawn.ts` or just the aider-specific invocation (env).
- No schema changes, no config changes.
- Should be reproducible: run `jarvis run` against any spec with an aider-eligible model and confirm no browser opens.
- The fix does not affect `jarvis plan`.

## Open questions

- Does `--no-show-model-warnings` fully suppress all browser launches, or only model-warning ones? If aider opens browser for other reasons (e.g. auth), a broader env-based guard may still be needed.
- Is the model string being passed to aider one that LiteLLM doesn't recognise, triggering the warning? If so, is the model string correct, or is there a naming mismatch that should be fixed at the model-config level instead of (or in addition to) suppressing the warning?
- User says they haven't seen this in `jarvis plan` — worth confirming whether aider is even in the plan-mode agent list, or if plan mode just hasn't hit the warning condition yet.

## User Review

I want to fix the root cause. Part of plan should be a root cause analysis