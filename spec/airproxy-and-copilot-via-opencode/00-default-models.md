# 00 — Decide default models

## Problem

Each new provider-named agent ships with a default model string in
`patchModels`. The defaults should match the `safe-edits` posture's intent
of "competent coding model, low reasoning overhead, low cost" used by
`spec/patch-mode-models/`, and they should be models the user actually has
access to via opencode on the machines where they will run jarvis.

This subspec records the chosen defaults and the reasoning behind them.

## Inputs

Available AirProxy models (from `~/.config/opencode/opencode.json` on the
user's work machine):

- Coding-capable, free or low-cost: `claude-haiku-4.5`,
  `claude-sonnet-4.5`, `claude-opus-4.7`, `gpt-5-mini`, `gpt-5-nano`,
  `gemini-2.5-flash`.
- Premium/deep-thinking: `claude-opus-4.1`, `gpt-5.4`, `claude-sonnet-4.6`.

Available github-copilot models (via opencode):

- `claude-opus-4.7` is the current opencode default (`model` key in the
  reviewed `opencode.json`).
- Other models accessible through Copilot vary by subscription; the user
  should pick one they can call without per-token surprises.

## Decisions

- `patchModels.airproxy` default: `"AirProxy/claude-haiku-4.5"`.
  - Rationale: zero cost (per the user's AirProxy cost table),
    coding-capable, 144k context, comfortably handles jarvis prompts. If
    the user later prefers a different default, they edit
    `~/.jarvis/config.json`.
- `patchModels.copilot` default: `"github-copilot/claude-opus-4.7"`.
  - Rationale: matches the model the user is already running opencode
    with by default on their personal machine. Lower risk of "model not
    found" on first run.
- Both defaults are strings the agent factory passes verbatim to
  `OpencodeAgent` as `model`. Opencode itself validates `provider/model`
  shape at run time.
- `agentOrder` default after this spec: `["claude", "codex", "cursor"]`
  remains unchanged. The user opts in to `airproxy` / `copilot` via
  `jarvis config set-order`. Rationale: the harness should not assume
  every user has opencode configured.

## Tasks

- [ ] No code changes in this subspec. It records the defaults that
      subspec 02 will encode.
- [ ] Update this file under a new `## Final defaults` section if the
      reviewer disagrees with the choices above before subspec 02 starts.

## Acceptance criteria

- `## Final defaults` (or the existing `Decisions` block, if unchanged) is
  the single source of truth for subspec 02's defaults.
- Defaults are documented enough that the next maintainer can change them
  without spelunking through the model catalog.

## Documentation updates

- None. Subspec 04 handles README/docs updates.
