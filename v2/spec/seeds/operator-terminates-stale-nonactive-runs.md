---
name: operator-terminates-stale-nonactive-runs
---

# A paused, unresumable run can be neither resumed nor killed, and never ages out

## Problem

A run left `paused` with `unsupported_resume_context` (resume refuses it) is also unkillable: `jarvis run kill <id>` returns `run_not_active` because kill only acts on active runs. Since `paused` is not a terminal status, the run never ages out of the daemon's 50-newest-terminal `list` retention, so it paints in `jarvis run list` and the `jarvis tui` work tree forever. Observed 2026-08-16: two 2026-08-11 runs for `20260811T173344Z-tui-left-pane-width-and-timing-threshold` (whose spec shipped as #2838, subspec 01 hand-finished because the subspec continuation couldn't resume) were stuck `paused`/`not-live` with no operator clear path — the same non-terminal-state-with-no-clear-path gap as pipelines (`pipeline-list-display-retention`, `operator-dismisses-pipelines-from-display`), here for runs. The durable record should be kept — the operator wants it settled/hidden, not deleted.

## Decisions

- Give the operator a way to force-settle a stale non-active run to a terminal status (`killed`), so it ages out of retention and leaves the tui: either `jarvis run kill --force <id>` accepting a non-active paused/unresumable run, or a dedicated `jarvis run terminate <id>`. Rules out leaving `run_not_active` as the only response for a run that genuinely cannot be resumed or killed normally.
- Force-settlement records a terminal status and a `finished_at` (data retained, not deleted), so retention/aging behaves exactly like any other terminal run. Rules out a delete.
- Consider daemon-startup reconciliation of unresumable paused runs (extend the existing `reconcileOrphanedRuns` sweep) so a restart also clears runs stuck in `unsupported_resume_context`, not only runs that were mid-flight at daemon death. Plan decides whether to do the manual verb, the startup sweep, or both.
- Do not change resume semantics — this is about terminating what resume already refuses, not making it resumable. Rules out scope creep into the resume bug itself.

## Acceptance criteria

- [ ] A `paused` run that resume refuses (`unsupported_resume_context`) can be force-settled to `killed` by an operator command, with a `finished_at` recorded, pinned by a state/daemon test.
- [ ] After force-settlement the run is terminal and subject to normal 50-newest-terminal retention (drops from `list`/tui once older than the window), pinned by a test.
- [ ] The force path does not affect an active run's normal kill semantics, pinned by a test.
- [ ] If startup reconciliation is chosen: a daemon restart settles a stale unresumable paused run to terminal, pinned by a reconciliation test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — how to clear a stale paused/unresumable run (the force verb and/or startup reconciliation); cross-link the pipeline-clear seeds.
- `v2/docs/daemon-host.md` — force-settlement semantics and any startup reconciliation of unresumable paused runs.
