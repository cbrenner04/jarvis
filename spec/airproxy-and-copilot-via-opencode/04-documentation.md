# 04 — Documentation

## Problem

The `airproxy` and `copilot` agents need to be discoverable in the README
and the user needs an example configuration showing how to opt in.
Without this, the new agents exist in code but no one knows how to enable
them.

## Decisions

- README is the primary touchpoint, same as the prerequisite spec.
- The Agents table from `spec/opencode-as-agent/05-documentation.md`
  gains two new rows. Both note that they delegate to opencode and refer
  back to the opencode setup section for the permission stanza.
- Add a "Provider-named opencode agents" subsection that:
  - Explains the difference between using the generic `opencode` agent
    (user picks `provider/model`) versus the named `airproxy` / `copilot`
    agents (jarvis fills in the provider half).
  - Shows an example `~/.jarvis/config.json` with `agentOrder`:
    `["airproxy", "copilot"]` and matching `patchModels` overrides.
  - Notes that AirProxy on the user's work machine assumes the local
    sidecar (no auth required from jarvis); Copilot uses opencode's
    existing auth flow (`opencode providers` / `opencode auth`).
- Update the Quickstart's "Agents" reference paragraph to mention the
  new agents exist but stay opt-in.

## Tasks

- [ ] Add `airproxy` and `copilot` rows to the Agents table in
      `README.md`. CLI invoked column for both:
      `opencode run --model <provider>/<model> --format default <prompt>`.
      Notes column links to the opencode setup section and explains the
      `<provider>` half is fixed per agent.
- [ ] Add a "Provider-named opencode agents" subsection under Agents.
- [ ] Update the Config schema example in `README.md` to show the new
      `patchModels` defaults.
- [ ] Update the default-config bootstrap example in `README.md` to
      include the new keys.
- [ ] If subspec 02 replaced the `opencode` placeholder with a concrete
      model, update the docs accordingly.
- [ ] Cross-link from the existing opencode setup section to this one so
      readers landing on either find the other.

## Acceptance criteria

- README clearly distinguishes the generic `opencode` agent from the
  provider-named `airproxy` / `copilot` agents.
- The Agents table includes both new rows in the same shape as the
  existing rows.
- An example `~/.jarvis/config.json` is shown with both new agents in
  `agentOrder` and matching `patchModels` overrides.
- `bun run check` passes (Biome formatting on Markdown if applicable).

## Documentation updates

- `README.md` — Agents table, "Provider-named opencode agents"
  subsection, Config schema example, default-config example,
  cross-links.
