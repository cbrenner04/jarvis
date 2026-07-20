# `jarvis cleanup` needs a non-interactive confirm flag

## Problem

`jarvis cleanup` gates its `Apply cleanup? [y/N]` prompt on `stdin.isTTY === true`
(`v2/src/commands/cleanup-cli.ts:30`). A piped confirm — `printf 'y\n' | jarvis cleanup` or
`yes | jarvis cleanup` — is detected as non-interactive and prints
`stdin is not interactive; assuming "no"` → **Cancelled**. There is no `--yes`/`--force` flag; the
only options are `--dry-run` and `--abandon <name>`.

Consequence: an agent/automation session cannot run the session-close cleanup itself — it must hand
`jarvis cleanup` to the operator's own interactive shell every time. Observed repeatedly at session
close 2026-07-20.

## Decisions

- Add a non-interactive confirm flag (e.g. `--yes` / `-y`) that applies the previewed cleanup without
  a TTY prompt. Rules out treating piped input as an implicit "no".
- The flag applies the same plan that `--dry-run` previews; without it, non-interactive invocations
  still fail closed (assume "no"), preserving current safe default.
- Keep the interactive TTY prompt as the default when no flag is passed.

## Acceptance criteria

- [ ] `jarvis cleanup --yes` (non-interactive stdin) applies the cleanup that `--dry-run` previews,
      without prompting.
- [ ] `jarvis cleanup` with no flag and a non-TTY stdin still assumes "no" and changes nothing.
- [ ] `--yes` composes with `--abandon <name>` for non-interactive abandon.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document `--yes` for agent-driven / scripted close-out cleanup.
