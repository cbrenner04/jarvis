# Workflow detach after admission

Operators hand-background `jarvis run workflow` because attach blocks the shell for the full
workflow while the daemon already owns execution. Add opt-in `--detach` after the same admission
path as attach; on success the client prints the admission run ID and exits without client-side
`wait`.

Supersedes the deferred no-`--detach` decision in
`v2/spec/completed/20260714T023458Z-run-workflow-exit-status-tracks-run-outcome/` (“no current
caller needs it”).

## Prerequisites

- Workflow launch prints the workflow entry run ID on stdout immediately after daemon admission
  (already on `main`).
- Daemon rollup on entry `wait`/`list` reports the workflow entry run's terminal outcome (already
  on `main`).

## Decisions

- Opt-in `--detach` on every registered `jarvis run workflow <preset>` invocation and each preset's
  reviewed/legacy CLI aliases; default remains attached — rules out a new top-level subcommand or
  env-only surface.
- Parse `--detach` once in the shared workflow CLI path so intent, plan, and implement presets
  share it — rules out implement-only detach.
- Update workflow usage/help strings for each preset (and aliases) so `--detach` is documented.
- Detach runs the same pre-`start` validation, stale workspace reset, and daemon `start` admission
  as attach; only post-admission client behavior differs — rules out a shortened or alternate
  admission path. Preflight/reset IPC before `start` is unchanged; tests must not treat total IPC
  frame count as the detach invariant.
- On admitted detach: emit the same pre-run-ID stderr the attach path prints (intent paths line),
  then print the workflow entry run ID on stdout (same first stdout line as attach), exit `0`, and
  do not issue client-side `wait` — rules out killing, pausing, or canceling the workflow when the
  launching shell exits.
- Detach success stdout is the admission run ID line only (no terminal wait JSON line) — rules out
  implying detach observed workflow completion.
- Failed admission (daemon guard errors, invalid start response) is unchanged when `--detach` is on
  argv — rules out coupling detach to attach wait behavior or a detach-specific admission path.
- CLI-only; no daemon lifecycle or rollup behavior changes.

## Work

- Add `--detach` to shared workflow arg parsing and usage strings for all presets and aliases.
- Branch `startWorkflowRun` (or equivalent) so detach returns after printing the entry run ID;
  attach continues to call `waitForRunCompletion` on that same ID (attach pinning ships in
  [01](./01-workflow-attached-entry-terminal-wait-contract.md)).
- Extend `workflow.test.ts` with detach IPC coverage, failed-admission coverage with `--detach` on
  argv, and a detach-continuation case where the entry run reaches terminal after the CLI has
  exited.

## Acceptance criteria

- [ ] `workflow.test.ts` regression `run workflow implement with --detach admits and exits without client wait` asserts exit `0`, no client `wait` after admission (preflight/reset RPCs unconstrained), workflow entry run ID as the only stdout line, and the same pre-run-ID stderr as attach; fails against pre-fix attach-only behavior.
- [ ] `workflow.test.ts` regression `after detach the workflow reaches workflow entry terminal while the launching CLI has already exited` drives a daemon fixture past admission without a client `wait` and asserts the entry run is terminal while the subprocess has already exited `0`; fails against pre-fix attach-only behavior.
- [ ] `--detach` is accepted on intent, plan, and implement workflow invocations (including reviewed/legacy aliases); workflow help/usage for each documents the flag.
- [ ] With `--detach` on argv, failed daemon admission matches attach: non-zero exit, named stderr, no run ID on stdout (extend or mirror `run workflow implement passes through daemon guard errors without local workflow logic`).
- [ ] Inverting the detach guard (always calling `waitForRunCompletion` after `start` even when `--detach` is set) fails `run workflow implement with --detach admits and exits without client wait`.
- [ ] `workflow.test.ts` `run workflow implement passes through daemon guard errors without local workflow logic` stays green.

## Documentation updates

- `v2/docs/write-behavior.md` — detach vs attach launch modes, per-mode stdout, and `--detach` on the
  workflow run-control surface (not prose-only).
- `v2/docs/operator-runbook.md` — launching workflows without blocking a shell via `--detach`;
  detach exit `0` means **admitted**, not workflow succeeded; observe progress via the admission run
  ID.
- `v2/docs/v1-behaviors.md` — `--detach` alongside attached workflow-terminal wait.
