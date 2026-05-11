# 05 — Documentation

## Problem

The new opencode agent, the configuration changes, the quota-signal list,
and the permission-installation helper all need to be discoverable in the
project docs. Without this, future users will not know opencode is a
supported agent or how to set it up safely.

## Decisions

- README is the primary touchpoint. Update the existing sections rather
  than creating new top-level documents.
- Keep the README "Agents" table the source of truth for invocation flags.
- Mention the safe-edits permission helper exactly once, where it is most
  relevant (the opencode entry in the Agents section and a one-line note
  in Quickstart).
- `AGENTS.md` and `docs/spec-guidance.md` do not need updates.

## Tasks

- [ ] Add an `opencode` row to the Agents table in `README.md` with:
      - CLI invoked: `opencode run --model <provider/model> --format default <prompt>`.
      - Notes column: `--model` is required; prompt is passed as the
        trailing positional argument; permissions handled via global
        opencode config (link to subspec 04).
- [ ] Add a new "Opencode setup" subsection under the Agents heading (or
      inline near the table) that explains:
      - Opencode is opt-in (not in default `agentOrder`).
      - Users must run `bun run install-opencode-permissions` once to
        configure the safe-edits posture in
        `~/.config/opencode/opencode.json`.
      - To use opencode, edit `agentOrder` and `patchModels.opencode` in
        `~/.jarvis/config.json`. Example shown.
      - Provider-specific setup (AirProxy, github-copilot) is covered in
        the follow-up spec and will be documented separately when that
        spec lands.
- [ ] Update the "Agent CLI verbosity" subsection to add an `Opencode` bullet
      naming `--format default` and the rationale (matches plain-text
      transcript shape of the other agents).
- [ ] Update the `Config` schema example in `README.md` to show
      `opencode` in `patchModels` (with the placeholder string) and a note
      that adding it to `agentOrder` is opt-in.
- [ ] Update `docs/quota-signals.md` only if subspec 03's edit there needs
      cross-linking. (Subspec 03 owns the actual quota-signals content.)

## Acceptance criteria

- README clearly states opencode is supported, how to enable it, and how
  to install the permission stanza.
- The Agents table includes an `opencode` row consistent with the existing
  rows.
- No mention of provider-specific opencode wiring (AirProxy, Copilot)
  beyond a forward reference to the follow-up spec.
- `bun run check` passes (Biome formatting on Markdown if applicable).

## Documentation updates

- `README.md` — Agents table, opencode-setup subsection, Agent CLI
  verbosity bullet, Config schema example.
