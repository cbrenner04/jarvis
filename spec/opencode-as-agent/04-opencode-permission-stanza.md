# 04 — Opencode permission stanza

## Problem

Opencode's `run` subcommand prompts interactively for permission to edit,
write, or run bash unless the user has pre-allowed those actions in their
opencode config. Jarvis-driven runs are non-interactive, so without
pre-allowed permissions the run stalls. Jarvis must not pass
`--dangerously-skip-permissions` (per the policy in `README.md`), so the
fix is to install a permission stanza in
`~/.config/opencode/opencode.json` that matches the `safe-edits` posture
defined in `spec/permissions/00-default-posture.md`.

This subspec installs that stanza, idempotently, and documents it. It
depends on subspec 00 having verified the actual schema.

## Decisions

- Edit scope: **global** opencode config at `~/.config/opencode/opencode.json`.
  Per-project `opencode.json` is out of scope here.
- Mechanism: a one-off helper `bun run scripts/install-opencode-permissions.ts`
  (or equivalent path under `scripts/`) that:
  - Reads the existing config if present.
  - Deep-merges the verified `permission` block from subspec 00 into the
    existing object, preserving any unrelated user-set keys.
  - Writes the result atomically (write-temp + rename).
  - Is idempotent: re-running it on a config that already contains the
    stanza is a no-op.
  - Refuses to overwrite a user-set permission key that conflicts with the
    target value; instead prints a diff and exits non-zero with a clear
    message asking the user to reconcile manually.
- Jarvis itself does **not** auto-run this script. It is a one-time setup
  step documented in the README. Rationale: jarvis stays out of the user's
  global opencode config; the user explicitly invokes the helper.
- The script is shipped under `scripts/` so it is discoverable but not
  exported as a jarvis subcommand.

## Behavior

Resulting `~/.config/opencode/opencode.json` after the helper runs (only
the relevant keys shown — the user's other keys are preserved):

```json
{
  "permission": {
    // exact content set by subspec 00's verified schema
  }
}
```

If the user already has a `permission` key with values that would be
overwritten:

```text
$ bun run scripts/install-opencode-permissions.ts
error: existing ~/.config/opencode/opencode.json sets permission.edit="ask";
the safe-edits posture requires "allow". Update manually or remove the
conflicting key before re-running.
```

## Tasks

- [ ] Create `scripts/install-opencode-permissions.ts` implementing the
      logic above.
- [ ] Source the canonical `permission` block from subspec 00's
      `## Verified schema` section (copy-paste; the helper does not fetch
      anything at runtime).
- [ ] Add a test under `test/` that runs the helper against a tmpdir with:
      - No existing config (helper creates the file).
      - Existing unrelated config (helper preserves other keys and merges
        the stanza).
      - Existing matching stanza (helper exits 0 without writing).
      - Existing conflicting stanza (helper exits non-zero with a clear
        message).
- [ ] Wire the script into `package.json` scripts as
      `"install-opencode-permissions": "bun run scripts/install-opencode-permissions.ts"`
      so users invoke it as `bun run install-opencode-permissions`.

## Acceptance criteria

- `bun run install-opencode-permissions` is idempotent.
- On a fresh machine with no opencode config, the helper creates the file
  and writes the safe-edits posture.
- On an existing machine, unrelated keys (`provider`, `mcp`,
  `enabled_providers`, etc.) are preserved verbatim.
- Conflicting user-set permissions trigger an explicit error rather than a
  silent overwrite.
- `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

- None. Subspec 05 documents the helper in the README.
