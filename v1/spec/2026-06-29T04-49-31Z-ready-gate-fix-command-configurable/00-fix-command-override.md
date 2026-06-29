# Per-project `fixCommand` override

## Problem

Full-tier ready gates hardcode `bun run fix`. Repos without a `fix` script (or non-bun package managers) fail immediately (`Script not found "fix"`). Only `readyCommand` is configurable today. Add a per-project autofix override parallel to `readyCommand`; when the resolved autofix script is absent, skip autofix instead of failing the gate. Unset `fixCommand` keeps `bun run fix` for repos that already pass; non-bun or no-`fix`-script repos must set `fixCommand` (or accept absent-script skip on default).

## Decisions

- Config key: `projects.<name>.fixCommand` (non-empty string when set; same validation surface as `readyCommand`) — rules out `modes.patch.fixCommand` or other non-project paths.
- Execution: tokenize on whitespace and run via `execFileSync` (no shell), mirroring `readyCommand` — rules out shell interpretation.
- Unset `fixCommand` keeps default `bun run fix` for repos that already pass — rules out changing the jarvis-repo path when the field is omitted.
- Absent-script skip predicate: before invoking autofix on `full` tier, when the resolved command matches `<pm> run [<flags>…] <script>` with `<pm>` in `bun`, `npm`, `pnpm`, `yarn`, extract `<script>` as the first non-flag token after `run` (default unset → `fix`); if root `package.json` is missing, unreadable, or lacks `scripts[<script>]`, skip autofix with no `FixCommandError` — rules out gate failure on absent scripts or bad manifests.
- Non-package-manager `fixCommand` (shape does not match the PM `run` pattern above) always executes with no `package.json` pre-check — rules out spurious skip for arbitrary executables.
- Absent-script skip skips autofix invocation only; commit-if-dirty and verification (`readyCommand` or `bun run ready`) keep current order and failure semantics — rules out skipping the rest of the `full` pre-verify phase.
- Non-absent autofix non-zero exit remains retryable `FixCommandError` — rules out swallowing real fix failures.
- `fixCommand` replaces harness autofix only; `readyCommand` stays verification-only — rules out folding verification into `fixCommand`.
- Patch-mode resolve once from `preflight.cfg.projects[preflight.project.key]?.fixCommand` and thread through gate calls — rules out per-site re-resolution.
- Triage resolve `fixCommand` via registered-project `root === opts.projectRoot` match (parallel to `readyCommand`); extend `runGate` seam (or resolve both commands before the default closure) so `--mark-ready` and `--merge` share it — rules out mark-ready-only wiring.
- Plan-mode resolve `fixCommand` via registered-project `root === plan worktree cwd` match (parallel to triage `readyCommand`); `maybeMarkPlanPrReady` threads it into `runReadyAndCommit` — rules out plan draft→ready with no config path.
- All `full`-tier gate sites that run harness autofix today honor `fixCommand`: patch completion, pre-shrink, review baseline, review final, every `maybeMarkReady` caller (`completion-pipeline` patch-complete and review-incomplete paths; `iteration.ts` per-subspec early-ready paths when shrink/review deferred), triage `--mark-ready` / `--merge`, and plan-mode draft→ready — rules out completion-only wiring.
- Plan-mode `readyCommand` stays unwired; only autofix picks up `fixCommand` — rules out plan verification override churn.
- `fast` tier still skips autofix and pre-ready commit — rules out tier behavior drift.

## Task checklist

- [ ] Add `fixCommand?: string` to `Project`, validate in `loadConfig`, add to strict project allowed-key set.
- [ ] Implement absent-script skip predicate in `runReadyAndCommit`; resolve autofix: unset → `bun run fix`; set → tokenized `fixCommand`.
- [ ] Thread optional `fixCommand` from project config to every `full`-tier gate call site listed in decisions (including `iteration.ts` early-ready paths that today omit `readyCommand`).
- [ ] Triage: resolve `fixCommand` by project-root match; extend `runGate` seam (or pre-resolve) so `--mark-ready` and `--merge` pass it through.
- [ ] Plan-mode: resolve `fixCommand` by plan worktree cwd project-root match; thread into `maybeMarkPlanPrReady`.
- [ ] Documentation updates below.

## Acceptance criteria

- [x] A registered project with `fixCommand` set runs that command in place of `bun run fix` on forced `full` tier, with a test per gate site asserting the configured command is invoked: patch completion transition, pre-shrink, review baseline, review final (force `full` when tier-selecting, e.g. `--resume-review` or no recorded-green carrier), `maybeMarkReady` at each caller (`completion-pipeline` patch-complete and review-incomplete; `iteration.ts` early-ready when shrink/review deferred — force `full` when the site would otherwise select `fast` on an unchanged tree), triage shared gate helper for `--mark-ready` and `--merge`, and plan-mode draft→ready.
- [x] Triage resolves `fixCommand` from the registered project whose `root` matches `opts.projectRoot` and passes it to the gate (test asserts configured autofix at `--mark-ready` or `--merge`).
- [x] On `full` tier with no `fix` script in `package.json` and unset `fixCommand`, the gate skips autofix and still runs commit-if-dirty (when applicable) and verification without `FixCommandError`.
- [x] On `full` tier with `fixCommand` naming a package-manager script absent from `package.json`, the gate skips autofix and still runs commit-if-dirty (when applicable) and verification without `FixCommandError`.
- [x] On `full` tier with missing or unparseable root `package.json` and a PM-shaped default or configured `fixCommand`, the gate skips autofix without `FixCommandError`.
- [x] A non-PM `fixCommand` (e.g. a direct executable path) runs with no `package.json` script pre-check.
- [x] When autofix runs and exits non-zero, the gate surfaces `FixCommandError` naming the configured or default fix command with captured output (retryable classification unchanged).
- [x] `loadConfig` rejects `fixCommand` that is empty, whitespace-only, or non-string; a config with `fixCommand` round-trips through load/write unchanged.
- [x] A project with no `fixCommand` and a repo that has a `fix` script still runs `bun run fix` on `full` tier; commit-if-dirty, verification (`readyCommand` or `bun run ready`), and green-over-dirty abort behavior are unchanged.
- [x] `fast` tier never invokes autofix or pre-ready commit; `ready-gate.test.ts` fast-tier tests stay green.
- [x] `ready-gate.test.ts` and existing gate-site tests that stub `runFix` and omit `fixCommand` stay green.

## Documentation updates

- [ ] `v1/docs/config.md`: document `fixCommand` (per-project, optional; replaces built-in `bun run fix` on `full` gates; tokenized, no shell; absent script is a no-op) and add it to the strict project-key list.
- [ ] `v2/docs/v1-behaviors.md`: record per-project `fixCommand`, absent-script no-op, and updated `full`-tier gate ordering (autofix override before verification-only `readyCommand`).
- [ ] `v1/docs/operator-runbook.md` — The gate section: configurable autofix via `fixCommand`, absent-script skip, default `bun run fix` when unset; non-bun/no-`fix`-script repos must configure `fixCommand`.
- [ ] `v1/docs/run-loop.md`: replace hardcoded `bun run fix` gate descriptions with `fixCommand` override and absent-script skip; note non-bun/no-`fix`-script repos must configure `fixCommand`.
- [ ] `ReadyVerificationDirtyError` operator guidance (error text and/or docs): reference `fixCommand` for autofix, not “fold autofix into `readyCommand`”.
