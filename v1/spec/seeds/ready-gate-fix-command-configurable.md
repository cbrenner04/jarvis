# Ready-gate: configurable/optional autofix + tolerate mutating readyCommand

Source: [intake #766](https://github.com/cbrenner04/jarvis/issues/766). Full-tier ready
gate (`v1/src/ready-gate.ts`) cannot finalize a `run` in an npm/coverage-`autoUpdate`
repo even when impl + tests are complete and the draft PR is pushed. Two coupled bugs;
both forced hand-finalize on groceries-client (`readyCommand = "npm run test:ci"`).

## Problem

1. **Hardcoded `bun run fix`.** `realRunFix` unconditionally runs `bun run fix`. Repos
   without a `fix` script (or non-bun repos) fail the gate immediately: `Script not
   found "fix"`. No config knob exists (only `readyCommand`).
2. **Post-ready dirty check vs mutating readyCommand.** Sequence is runFix →
   commit-if-dirty → runReady → throw `ReadyVerificationDirtyError` if dirty after ready.
   A legitimate mutating readyCommand (vitest `coverage.thresholds.autoUpdate: true`
   rewrites `vite.config.ts`; snapshot regen `-u` rewrites `*.snap`) can never leave a
   clean tree, so it always throws. Structural conflict, not operator error.

## Decisions

- Make the autofix command configurable (e.g. `modes.patch.fixCommand` / project-level);
  rules out a hardcoded bun-only `bun run fix`.
- **No-op autofix when the configured/default script is absent** rather than hard-failing;
  rules out gate death on repos with no `fix` script.
- For post-ready churn: extend the existing `chore: apply pre-ready check:fix` auto-commit
  to also absorb readyCommand-produced ratchet/snapshot churn (run readyCommand, then
  commit residual dirt, then assert), **or** allow a configured expected-dirty allowlist;
  rules out `ReadyVerificationDirtyError` on a legitimately-mutating readyCommand.
- Keep current behavior unchanged for repos that already pass (bun repo with a `fix`
  script, non-mutating readyCommand); rules out gate churn for the common path.

## Documentation updates

- `v2/docs/v1-behaviors.md` — update the ready/fix gate ordering and the new
  fixCommand/absent-script/post-ready-churn behavior (per specs-update-v1-behaviors rule).
- `v1/docs/operator-runbook.md` — note the configurable autofix in The gate section.
