---
name: operator-dismisses-runs-from-display
---

# Operator can't clear old workflow runs from the TUI / run list

## Problem

There is no way to clear a terminal `run workflow` invocation (ad-hoc or entry run) from the display. Pipelines got `jarvis pipeline dismiss` (durable `dismissed_at` flag, `includeDismissed` projection filter, `--all`/`undismiss`, TUI `D` toggle), but runs have no analog. Standalone terminal ad-hoc `run workflow` rows fill the `jarvis tui` work tree and `jarvis run list` and can only leave by aging past the 50-newest-terminal window (`LIST_TERMINAL_RUN_LIMIT`, `v2/src/daemon/daemon.ts`) — the operator can't actively shed a specific dead row. Dogfooding accumulated many weeks-old terminal runs cluttering the tree with no way to remove them. Durable records must be kept — this is a display hide, not a purge (mirror of the pipeline-dismiss decision).

## Decisions

- Mirror pipeline dismiss for runs: `jarvis run dismiss <id>` sets a durable `dismissed_at` flag on the run row; `jarvis run undismiss <id>` clears it. Add a `runs.dismissed_at` migration (like migration `027-pipeline-dismissed-at`), a `dismissRun`/`undismissRun` store method pair returning a dismissal outcome, and thread `dismissedAt` through `RUN_COLUMNS` and the run projection. Rules out deleting durable run rows.
- The default `list` RPC projection hides dismissed runs (filter `dismissedAt === null`), exactly as `pipeline_list` filters dismissed pipelines. `jarvis run list --all` widens to `{ includeDismissed: true }` and appends a `dismissed`/`-` column, mirroring `pipeline list --all`. Rules out a second, divergent visibility mechanism.
- Dismissal is display-only and independent of the 50-newest-terminal retention window: a dismissed run stays durable and loadable by id and via `--since`/`--all`. Dismissing a live (non-terminal) run succeeds but prints a stderr warning naming the run and its state and does not stop it — same contract as pipeline dismiss. Rules out coupling dismiss to termination.
- In `jarvis tui`, the existing `D` key (currently show/hide dismissed *pipelines*) also shows/hides dismissed runs — dismissed ad-hoc top-level rows and run leaves hide by default and paint with a `(dismissed)` marker when `D` reveals them, using the same session-only, non-persisted toggle. Rules out a separate key or a persisted setting.
- Reuse the pipeline dismiss/undismiss daemon RPC shape and CLI-argument/refusal conventions (unknown id prints the daemon `reason` verbatim on stderr, exits non-zero) so operators learn one rule. Rules out a bespoke run-dismiss RPC contract.

## Acceptance criteria

- [ ] A `runs.dismissed_at` column migration exists and `dismissRun`/`undismissRun` set/clear it, preserving the first dismissal timestamp on repeat dismiss and returning an already-clear signal on undismiss of a never-dismissed run, pinned by a state-store test.
- [ ] The default `list` projection excludes dismissed runs; `includeDismissed: true` includes them, pinned by a daemon/state test seeded with a dismissed and a non-dismissed terminal run.
- [ ] `jarvis run dismiss <id>` / `jarvis run undismiss <id>` durably set/clear the flag; `jarvis run list --all` shows dismissed rows with a trailing `dismissed`/`-` column while the default listing hides them, pinned by CLI-level tests.
- [ ] Dismissing a live run succeeds with a stderr warning and does not stop the run; an unknown id refuses with the daemon `reason` and a non-zero exit, pinned by tests.
- [ ] The TUI work tree hides dismissed ad-hoc/run rows by default and reveals them with a `(dismissed)` marker under the existing session-only `D` toggle, pinned by pure-function tests over the work-tree model.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document `jarvis run dismiss`/`undismiss` and `run list --all` alongside the pipeline-dismiss docs; note the TUI `D` toggle now covers runs as well as pipelines. Cross-link `pipeline-list-display-retention` and `operator-dismisses-pipelines-from-display`.
- `v2/docs/daemon-host.md` — the `list` RPC `includeDismissed` parameter and run dismissal semantics, parity with `pipeline_list`.
