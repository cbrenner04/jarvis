---
name: cleanup-non-interactive-confirm-flag
---

# Non-interactive confirm for `jarvis cleanup`

## Outcome

- `jarvis cleanup --yes` applies the same retirement plan `--dry-run` previews without a TTY prompt.
- `jarvis cleanup --yes --abandon <name>` applies the same abandon plan `--dry-run` previews without a TTY prompt.
- Non-interactive invocations without `--yes` still assume "no" and change nothing.

## Decisions

- Add `--yes`/`-y` to apply the previewed cleanup without a TTY prompt; rules out treating piped stdin as implicit confirmation.
- `--yes` applies the same plan `--dry-run` previews; rules out a divergent apply path or auto-confirm on non-TTY without the flag.
- Non-interactive invocations without `--yes` still assume "no" and change nothing; rules out fail-open defaults for scripted runs.
- Interactive `[y/N]` remains the default when no confirm flag is passed; rules out requiring `--yes` on an operator TTY.
- Deferred to first consumer: `--yes` combined with `--dry-run` — pin when a caller needs it.

## Acceptance criteria

- [ ] `jarvis cleanup --yes` with non-interactive stdin applies the cleanup that `--dry-run` previews, without prompting.
- [ ] `jarvis cleanup` with no flag and a non-TTY stdin still assumes "no" and changes nothing.
- [ ] `jarvis cleanup --yes --abandon <name>` with non-interactive stdin applies the abandon plan that `--dry-run` previews, without prompting.
- [ ] `cleanup-cli.test.ts` regressions for non-interactive `--yes` apply and fail-closed default fail against the baseline and pass after implementation.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document `--yes` for agent-driven and scripted close-out cleanup.
- `v2/docs/v1-behaviors.md` — record v2 cleanup non-interactive confirm semantics.

## Prerequisites

- `jarvis cleanup --dry-run` previews merged-worktree retirement and stranded-spec archival without prompting or mutating.
- `jarvis cleanup` and `jarvis cleanup --abandon <name>` gate apply on an interactive `[y/N]` prompt when stdin is a TTY.
