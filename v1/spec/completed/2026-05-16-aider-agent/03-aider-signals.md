# 03 — Aider quota and model-config signals

## Problem

`src/agents/quota.ts` maps per-agent exit codes and stderr substrings to
`quota` or `model_config` results so the harness can fall back to the next
agent instead of crashing. Aider is a wrapper over arbitrary backends
(local LLMs via Ollama / llama.cpp / LM Studio, or hosted OpenAI-compatible
APIs), so its possible failure surface is broader than a single-provider
CLI like `claude`.

The harness still needs deterministic detection so fallback works. This
subspec documents the initial signal set and wires it into `quota.ts`.

## Decisions

- Detection is best-effort and based on substring matching against
  `stdout + stderr`. False negatives surface as `kind: "error"` (current
  behavior for unknown failures); false positives are worse, so the
  initial set is conservative.
- Local LLMs have no per-token quota in the hosted-provider sense, but
  they can still surface "server unreachable" / "model not loaded" errors
  from the local runtime. Those are treated as **model_config** signals,
  not quota signals — the right user response is "load the model or start
  the server", not "wait for quota reset".
- Initial **quota signals** (case-insensitive, only when exit code is
  non-zero) — relevant when aider is pointed at a hosted backend:
  - `"rate limit"`.
  - `"quota exceeded"`.
  - `"insufficient_quota"` (OpenAI-compatible error code).
  - `"429"` appearing in an error line.
- `isModelConfigurationSignal` in `quota.ts` does **not** take an exit
  code today — it is called from sites that have already established the
  agent failed. Aider follows that contract: the new aider branch in
  `isModelConfigurationSignal(name, stderr)` only inspects stderr.
  Callers (existing code) decide when to run it.
- Initial **model_config signals** (case-insensitive, matched on
  stderr):
  - `"model not found"`.
  - `"unknown model"`.
  - `"unsupported model"`.
  - `"invalid model"`.
  - `"could not connect to ollama"` (Ollama runtime not running).
  - `"connection refused"` combined with a model/host substring (catches
    LM Studio / llama.cpp not running).
  - `"model is not loaded"` / `"no such model"` (Ollama-specific phrasing
    when the named model isn't pulled locally).
- These signals are added to aider-only branches in `quota.ts`. Existing
  per-agent signal logic for other agents is **not** touched.
- Confirm or adjust each substring against subspec 00's verified flag /
  error-output capture before landing. If real aider output differs,
  update this list.

## Tasks

- [ ] Add `aiderQuotaPatterns` and `aiderModelConfigurationPatterns`
      arrays to `src/agents/quota.ts` mirroring the existing
      `opencodeQuotaPatterns` / `opencodeModelConfigurationPatterns`
      shape.
- [ ] Extend the `switch (name)` inside `isQuotaSignal` to return
      `aiderQuotaPatterns` for `"aider"` (keeping the existing
      `exitCode === 0` guard).
- [ ] Extend `isModelConfigurationSignal` so when `name === "aider"` it
      runs `[...modelConfigurationPatterns, ...aiderModelConfigurationPatterns]`,
      following the same pattern the function already uses for
      `"opencode"`. Do not add an exit-code guard — the function does
      not take one.
- [ ] Do not refactor existing branches.
- [ ] Add tests for each substring in both `isQuotaSignal` and
      `isModelConfigurationSignal` so regressions surface immediately.
- [ ] Add a test that ensures `isQuotaSignal("aider", 0, stderr)` returns
      `false` even when `stderr` contains a matching substring. (No
      equivalent test is needed for `isModelConfigurationSignal` because
      it has no exit-code argument and is only called after a failed
      run.)
- [ ] Document the signal set under an `## Aider` heading. First check
      whether quota signals are documented somewhere today (look for any
      existing file under `docs/` mentioning quota signals, or a section
      in `README.md`). If such a location exists, append the `## Aider`
      subsection there. If none exists, create `docs/quota-signals.md`
      with sections for the existing agents (lifted from current source
      comments / `quota.ts`) plus the new `## Aider` section. Either way,
      the new section lists the substrings above and notes the list is
      expected to grow.

## Acceptance criteria

- [x] `bun run typecheck`, `bun test`, and `bun run check` pass.
- [x] An `AiderAgent` failure where stderr contains `"rate limit reached"`
      returns `kind: "quota"`.
- [x] An `AiderAgent` failure where stderr contains
      `"could not connect to ollama"` returns `kind: "model_config"`.
- [x] A successful (`code === 0`) aider run still returns `kind: "ok"`
      even if stdout mentions one of the substrings.

## Documentation updates

- `docs/quota-signals.md` — append an `## Aider` section listing the
  initial signal set. (Counted as spec-required docs, not part of
  subspec 04.)
