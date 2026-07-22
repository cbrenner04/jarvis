# Cleanup non-interactive confirm flag

Agent and scripted close-out need to apply the cleanup `--dry-run` already previews without a TTY `[y/N]` prompt. Today non-TTY stdin fail-closes to "no" and mutates nothing.

## Decisions

- Add `--yes`/`-y` as explicit non-interactive apply confirmation; rules out treating piped stdin as implicit confirmation.
- `--yes` applies the same plan `--dry-run` previews through the existing apply path; rules out a divergent apply path or auto-confirm on non-TTY without the flag.
- Non-interactive invocations without `--yes` still assume "no" and change nothing; rules out fail-open defaults for scripted runs.
- Interactive `[y/N]` remains the default when no confirm flag is passed; rules out requiring `--yes` on an operator TTY.
- Deferred to first consumer: `--yes` combined with `--dry-run` — pin when a caller needs it.

## Work

- Parse `--yes`/`-y` in `runCleanupCliCommand`; extend `CLEANUP_USAGE`.
- When `--yes` is set, skip the prompt and apply the previewed retirement or abandon plan (not `--dry-run`).
- Add `cleanup-cli.test.ts` end-to-end regressions: non-interactive `--yes` apply for default cleanup and `--abandon`, and non-interactive default cleanup without `--yes` still changes nothing.
- Document `--yes` in the operator runbook and v1 parity catalog.

## Acceptance criteria

- [x] `jarvis cleanup --yes` with non-interactive stdin applies the cleanup that `--dry-run` previews, without prompting.
- [x] `jarvis cleanup` with no flag and a non-TTY stdin still assumes "no" and changes nothing.
- [x] `jarvis cleanup --yes --abandon <name>` with non-interactive stdin applies the abandon plan that `--dry-run` previews, without prompting.
- [x] `cleanup-cli.test.ts` regressions for non-interactive `--yes` apply and the fail-closed default fail against the baseline and pass after implementation.
- [x] `createPromptFunction` TTY and non-TTY tests in `cleanup-cli.test.ts` stay green.
- [x] `v2/docs/operator-runbook.md` documents `--yes` for agent-driven and scripted close-out cleanup.
- [x] `v2/docs/v1-behaviors.md` records v2 cleanup non-interactive confirm semantics.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document `--yes` for agent-driven and scripted close-out cleanup.
- `v2/docs/v1-behaviors.md` — record v2 cleanup non-interactive confirm semantics.
