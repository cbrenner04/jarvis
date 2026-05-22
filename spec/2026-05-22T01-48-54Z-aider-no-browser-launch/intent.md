---
name: aider-no-browser-launch
---

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

## Refine turn 1

### Root cause analysis structure

The user wants the spec to include root cause analysis as a visible, distinct step — not just suppression. The plan should produce two subspecs:

**Subspec 00 — root cause analysis**: An implementing agent reads `~/.jarvis/config.json`, identifies the model string currently configured for aider, and determines *why* the browser opens. The three possible root causes are:

1. **Model naming mismatch**: The model string doesn't match LiteLLM's expected format (e.g., `my-custom-llama` instead of `ollama/llama3`). Fix: correct the model string in config or the string used for the `--model` flag.
2. **Model not in LiteLLM's registry**: The model exists and works but has no pricing/capability metadata in LiteLLM's built-in list. LiteLLM emits a warning on every call. Fix: suppressing the warning with `--no-show-model-warnings` is *the correct resolution* — it is not just a workaround.
3. **Genuine misconfiguration (model unreachable/unrecognized)**: LiteLLM can't talk to the model at all and falls back to the warning page. Fix: correct the provider prefix or model name in config so it's actually resolvable.

The agent performing the root cause analysis can distinguish these by: checking whether the `aider` run would exit with a `model_config` signal (as handled by `isModelConfigurationSignal` in `src/agents/quota.ts`) vs. exiting 0 while still having opened the browser. Browser opens on exit-0 runs indicate case 2; browser opens on failed runs indicate case 1 or 3.

Root cause findings should be written into the subspec itself as a `## Findings` section (or a small dedicated doc), so the fix subspec has a documented basis.

**Subspec 01 — apply the fix**: Based on findings from subspec 00:

- If case 1 or 3: fix the model string in the config layer (document the correct format in `docs/` and, if applicable, add a validation note in `src/agents/aider.ts`).
- If case 2 (or after fixing 1/3 if warnings persist): add `--no-show-model-warnings` to `buildArgv` in `src/agents/aider.ts` (lines 56–70), which is the correct aider-supported suppression mechanism.
- Belt-and-suspenders: also inject `BROWSER: ""` into the subprocess env for the aider agent — this prevents any browser open regardless of aider version or undocumented code paths.

### Structural note: injecting `BROWSER=` requires a `SpawnConfig` env field

`spawn.ts` line 26 constructs env as `{ ...process.env, PWD: config.cwd }` without any caller-supplied overrides. To inject `BROWSER: ""` only for aider (not all agents), `SpawnConfig` needs an optional `env?: Record<string, string>` field that gets merged during env construction. This is a small, isolated change to `spawn.ts` and `aider.ts`. Alternatively, the env can be set inline in `spawn.ts` conditioned on `config.name === "aider"`, but the `env` field approach keeps agent-specific concerns in the agent file.

This structural change means the fix subspec has two parts: (a) extend `SpawnConfig` with `env?`, (b) set `BROWSER: ""` in the aider `SpawnConfig` call.

### Tests to add

- A new test in `test/agents/aider.test.ts` asserting that the spawned process receives `BROWSER=` in its environment (inspectable via the fake binary script that already records `argv` — extend it to also record `env`).
- A test asserting `--no-show-model-warnings` is present in `argv` (if case 2 is confirmed as the root cause).
- The root cause subspec should include a test or a manual verification step that confirms the actual model string in `~/.jarvis/config.json` is correctly formed (e.g., passes `aider --list-models` without a warning).

### Scope boundary

No changes to `jarvis plan` code paths, no schema or config schema changes. The `env?` field addition to `SpawnConfig` is the only structural expansion; all other agents continue to work unchanged (they pass no `env` override, so behavior is identical to today).

## Refine turn 2

### Exact code locations for the two-file change

**`src/agents/spawn.ts`** — two edits:
- Interface `SpawnConfig` (lines 9–17): add `env?: Record<string, string>` as an optional field after `streamErrorPrefix`.
- Line 26 env construction: change `{ ...process.env, PWD: config.cwd }` to `{ ...process.env, PWD: config.cwd, ...config.env }`. The spread of `config.env` goes last so caller overrides win. When `config.env` is undefined the spread is a no-op (`...undefined` evaluates to nothing in JS object spread).

**`src/agents/aider.ts`** — two edits:
- Add `"--no-show-model-warnings"` to the `argv` array in `buildArgv` (after `"--no-stream"`, line 66 area).
- Add `env: { BROWSER: "false" }` to the `SpawnConfig` object literal passed to `runAgent` (the object currently ends at `streamErrorPrefix: "aider:"` on line 73).

### `BROWSER=false`, not `BROWSER=""`

Python's `webbrowser` module checks `"BROWSER" in os.environ` (truthy even for `""`), then splits the value on `os.pathsep`. Setting `BROWSER=""` yields `['']`, which Python attempts to register as a browser command — behavior is implementation-defined and may still invoke the OS default. Setting `BROWSER=false` causes Python to try executing `/usr/bin/false` (or the shell builtin `false`) as the browser command, which exits 1 silently. This is the standard Unix pattern for suppressing subprocess browser opens. Update the `env` field to `{ BROWSER: "false" }` (not `""`).

### Test extension for env capture

The `fakeBinary` function in `test/agents/aider.test.ts` (lines 27–47) records argv and cwd via the bash script. Extend the script to also emit the `BROWSER` env var:

```bash
printf '%s' "${BROWSER:-__unset__}" > "${dir}/browser_env"
```

The new test then reads `${dir}/browser_env` and asserts the value is `"false"`. The `__unset__` sentinel lets the test distinguish "was not passed" from "was passed as empty string" — the assertion should be exactly `"false"`.

### Root cause subspec scope clarification

Subspec 00 cannot read `~/.jarvis/config.json` — that file is user-local and outside the repo. The root cause analysis is instead a *documentation and code investigation* task:

1. The implementing agent reads aider's docs and/or source to confirm the three warning trigger conditions (model naming mismatch, model missing from LiteLLM registry, genuine misconfiguration).
2. It checks `src/agents/quota.ts` `modelConfigurationPatterns` (lines 50–59) to understand how jarvis already classifies the signals — this is relevant context for case 1/3.
3. It writes findings to `docs/aider-model-warnings.md` covering: what triggers LiteLLM to show the warning, what `--no-show-model-warnings` suppresses, and why the combined flag+env approach is the correct fix rather than a workaround.

The findings doc is the acceptance-criteria artifact for subspec 00. Subspec 01 proceeds unconditionally with the flag+env fix (the findings doc is background, not a conditional gate — all three root cause cases benefit from both `--no-show-model-warnings` and `BROWSER=false`).

### `SpawnConfig.env?` type choice

Use `Record<string, string>` (not `Partial<Record<string, string>>`). `process.env` values can be `string | undefined`, but the caller-supplied `env` field is for explicit overrides that should be definite strings. The env construction at line 26 already casts the whole merged object with `as Record<string, string>`, so `undefined` values from `process.env` are already being accepted. A definite `Record<string, string>` for `config.env` keeps the type clean and matches what callers actually pass.

## Refine skip

All code locations have been verified against the actual source. The intent is complete and consistent with the codebase. No further refinement is needed before drafting.

## Blocker

Review and approve `spec/2026-05-22T01-48-54Z-aider-no-browser-launch/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis plan --resume-draft spec/2026-05-22T01-48-54Z-aider-no-browser-launch/intent.md`
