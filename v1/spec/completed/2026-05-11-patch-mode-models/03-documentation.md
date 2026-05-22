# 03 — Documentation

## Problem

Users need to know that Jarvis now selects explicit patch-mode models, where
those defaults live, and what happens when a configured model is unsupported by
their installed CLI or account.

## Decisions

- Document `patchModels` as manual config in `README.md`.
- Document that the setting is patch-mode-specific.
- Document that Jarvis validates local config shape before running.
- Document that provider/account support is discovered from the selected
  underlying CLI's runtime error output, not by a preflight query.
- Keep the `jarvis config` command docs unchanged except for noting that model
  edits are manual JSON edits for now.

## Documentation content

Add or update README coverage with:

- The default patch-mode model map:

  ```json
  {
    "claude": "haiku",
    "codex": "gpt-5.3-codex",
    "cursor": "Composer 2"
  }
  ```

- A short explanation:

  Patch mode is intended for scoped implementation work from an active spec, so
  the defaults prefer lower-cost coding-capable models over deep-thinking
  models. Future Jarvis modes may use separate model settings.

- Unsupported model behavior:

  Jarvis does not query providers or CLIs before running to validate model
  availability. If the selected agent CLI reports that the configured model is
  unsupported, Jarvis exits with a model-configuration message and does not
  fall back to another agent. Fallback is reserved for quota exhaustion.

## Tasks

- [x] Update the README config example to include `patchModels`.
- [x] Update the "Agents" or run-loop documentation to describe patch-mode
  model selection.
- [x] Note that `patchModels` is edited manually in
  `~/.jarvis/config.json`.
- [x] Ensure documentation does not imply these model choices apply to future
  non-patch modes.

## Acceptance criteria

- README documents the default `patchModels` values.
- README explains that malformed `patchModels` config fails before an agent is
  invoked.
- README explains that unsupported model names are detected from selected-agent
  CLI diagnostics, cause Jarvis to exit, and do not trigger fallback.
- README says `patchModels` is patch-mode-specific.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- This subspec is the documentation update.
