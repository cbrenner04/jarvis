# Per-project `fixCommand` override

## Problem

Full-tier ready gates hardcode `bun run fix`. Repos without a `fix` script (or non-bun package managers) fail immediately (`Script not found "fix"`). Only `readyCommand` is configurable today. Add a per-project autofix override parallel to `readyCommand`; when the resolved autofix script is absent, skip autofix instead of failing the gate.

## Decisions

- Config key: `projects.<name>.fixCommand` (non-empty string when set; same validation surface as `readyCommand`) — rules out `modes.patch.fixCommand` or other non-project paths.
- Execution: tokenize on whitespace and run via `execFileSync` (no shell), mirroring `readyCommand` — rules out shell interpretation.
- Unset `fixCommand` keeps default `bun run fix` for repos that already pass — rules out changing the jarvis-repo path when the field is omitted.
- Absent resolved script (default `fix` or configured package-manager `run <script>` target missing from `package.json` `scripts`) skips autofix with no `FixCommandError` — rules out gate failure on repos with no fix script.
- Non-absent autofix non-zero exit remains retryable `FixCommandError` — rules out swallowing real fix failures.
- `fixCommand` replaces harness autofix only; `readyCommand` stays verification-only — rules out folding verification into `fixCommand`.
- Resolve once from `preflight.cfg.projects[preflight.project.key]?.fixCommand` (or triage's project-root match) and thread through `runReadyAndCommit` / `runReadyGateWithTier` — rules out per-site re-resolution.
- All `full`-tier gate sites that run harness autofix today honor `fixCommand`: patch completion, pre-shrink, review baseline, review final, `maybeMarkReady`, triage `--mark-ready` / `--merge`, and plan-mode draft→ready — rules out completion-only wiring.
- Plan-mode `readyCommand` stays unwired; only autofix picks up `fixCommand` — rules out plan verification override churn.
- `fast` tier still skips autofix and pre-ready commit — rules out tier behavior drift.

## Task checklist

- [ ] Add `fixCommand?: string` to `Project`, validate in `loadConfig`, add to strict project allowed-key set.
- [ ] Resolve autofix command in `runReadyAndCommit`: unset → `bun run fix`; set → tokenized `fixCommand`. Skip when the resolved package-manager script name is absent from `package.json` `scripts`.
- [ ] Thread optional `fixCommand` from project config to every `full`-tier gate call site listed above.
- [ ] Documentation updates below.

## Acceptance criteria

- [ ] A registered project with `fixCommand` set runs that command in place of `bun run fix` on `full` tier, with a test per gate site asserting the configured command is invoked: patch completion transition, pre-shrink, review baseline, review final, `maybeMarkReady`, triage `--mark-ready` (or shared triage gate helper), and plan-mode draft→ready.
- [ ] On `full` tier with no `fix` script in `package.json` and unset `fixCommand`, the gate skips autofix and proceeds to verification without `FixCommandError`.
- [ ] On `full` tier with `fixCommand` naming a package-manager script absent from `package.json`, the gate skips autofix and proceeds to verification without `FixCommandError`.
- [ ] When autofix runs and exits non-zero, the gate surfaces `FixCommandError` naming the configured or default fix command with captured output (retryable classification unchanged).
- [ ] `validateConfig` rejects `fixCommand` that is empty, whitespace-only, or non-string; a config with `fixCommand` round-trips through load/write unchanged.
- [ ] A project with no `fixCommand` and a repo that has a `fix` script still runs `bun run fix` on `full` tier; commit-if-dirty, verification (`readyCommand` or `bun run ready`), and green-over-dirty abort behavior are unchanged.
- [ ] `fast` tier never invokes autofix or pre-ready commit; `ready-gate.test.ts` fast-tier tests stay green.
- [ ] `ready-gate.test.ts` and existing gate-site tests that stub `runFix` and omit `fixCommand` stay green.

## Documentation updates

- [ ] `v1/docs/config.md`: document `fixCommand` (per-project, optional; replaces built-in `bun run fix` on `full` gates; tokenized, no shell; absent script is a no-op) and add it to the strict project-key list.
- [ ] `v2/docs/v1-behaviors.md`: record per-project `fixCommand`, absent-script no-op, and updated `full`-tier gate ordering (autofix override before verification-only `readyCommand`).
- [ ] `v1/docs/operator-runbook.md` — The gate section: configurable autofix via `fixCommand`, absent-script skip, default `bun run fix` when unset.
