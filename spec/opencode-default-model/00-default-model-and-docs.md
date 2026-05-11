# 00 — Default model and docs

## Problem

Two concrete artifacts remain from the abandoned
`airproxy-and-copilot-via-opencode` follow-up:

1. `src/config.ts` still ships `patchModels.opencode` as the placeholder
   string `"<configure-in-opencode-providers-spec>"`, set via the
   `OPENCODE_PATCH_MODEL_PLACEHOLDER` constant. The same placeholder is
   re-populated in legacy-config handling (`if (name === "opencode")` branch
   in `parsePatchModels`).
2. `docs/agents.md` ends with a paragraph promising that "Provider-specific
   opencode setup (for example AirProxy or github-copilot routing) is
   covered by the follow-up `airproxy-and-copilot-via-opencode` spec." That
   spec is gone; the docs need to explain the `provider/model` string
   directly.

## Decisions

- New default: `patchModels.opencode = "github-copilot/claude-opus-4.7"`.
  - Rationale: matches the user's current opencode default on their
    personal machine and is reachable with the credentials opencode already
    manages. AirProxy users override this via `~/.jarvis/config.json` on
    work machines.
- The `OPENCODE_PATCH_MODEL_PLACEHOLDER` constant is removed. There is no
  longer a placeholder phase.
- The legacy-config branch that re-injects the placeholder
  (`if (name === "opencode") { patchModels.opencode = ... }` in
  `parsePatchModels`) is kept but now backfills the real default, so legacy
  configs without `patchModels.opencode` still load.
- `docs/agents.md` documents `patchModels.opencode` as a `provider/model`
  string. The example block uses `github-copilot/claude-opus-4.7` (the new
  default) and notes `AirProxy/<model>` as the alternate form for the
  internal proxy.

## Tasks

- [ ] In `src/config.ts`:
  - Remove `OPENCODE_PATCH_MODEL_PLACEHOLDER`.
  - Set `DEFAULT_CONFIG.patchModels.opencode` to
    `"github-copilot/claude-opus-4.7"`.
  - Keep the legacy-config backfill branch but have it copy from
    `DEFAULT_CONFIG.patchModels.opencode` (it already does — confirm no
    other reference to the placeholder remains).
- [ ] In `docs/agents.md`:
  - Replace the trailing paragraph that references the abandoned
    `airproxy-and-copilot-via-opencode` spec with prose that explains
    `patchModels.opencode` is a `provider/model` string and lists the two
    providers the user actually uses (`github-copilot/...` and
    `AirProxy/...`) as examples.
  - Update the example JSON block so `"opencode"` is
    `"github-copilot/claude-opus-4.7"` instead of `"provider/model"`.
- [ ] In `docs/config.md` (if it references the opencode placeholder or
  promises a separate provider spec), align with the new wording. Otherwise
  skip.
- [ ] Update any test that asserts the placeholder value (search for
  `<configure-in-opencode-providers-spec>` in `test/`). Replace with the
  new default.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Acceptance criteria

- A freshly bootstrapped `~/.jarvis/config.json` has
  `"opencode": "github-copilot/claude-opus-4.7"` in `patchModels`.
- The string `<configure-in-opencode-providers-spec>` does not appear
  anywhere in the repo.
- The string `airproxy-and-copilot-via-opencode` does not appear anywhere
  in the repo.
- `docs/agents.md` explains the `provider/model` string and lists
  `github-copilot` and `AirProxy` as examples without introducing them as
  separate agents.
- `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

- `docs/agents.md` — see tasks above.
- `docs/config.md` — only if it currently references the placeholder or
  the abandoned follow-up spec.
