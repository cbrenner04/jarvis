---
name: operator-dismisses-pipelines-from-display
---

# Operator can dismiss a pipeline from the display without losing its record

## Problem

There is no way to remove a pipeline the operator no longer cares about from `jarvis pipeline list`, the `jarvis tui` work tree, or the needs-attention segment. `reject` only flips an awaiting gate to a terminal `rejected` state (still listed, and still an attention row), and `jarvis cleanup` only touches worktrees/specs — never pipeline records. Dogfooding 2026-08-16 accumulated 26 pipelines (14 failed, 9 abandoned awaiting, 2 rejected, 1 running); every one keeps painting in the list, tree, and attention segment with no operator action to clear it. The durable record must be kept — the operator wants it hidden, not deleted.

## Decisions

- Add an operator dismiss action that marks a pipeline hidden from the default display while retaining its full durable record: `jarvis pipeline dismiss <pipeline-id>` (and an undo, `jarvis pipeline undismiss <pipeline-id>`), or the equivalent folded into `jarvis cleanup`. Rules out deleting rows — this is a display flag, not a purge.
- Persist the dismissal as a durable nullable timestamp/flag on the pipeline row (new additive column + migration), so it survives daemon restarts and is not process-local. Rules out an in-memory hide.
- `pipeline list`, the TUI work tree, and the needs-attention segment exclude dismissed pipelines by default; an explicit opt-in (`jarvis pipeline list --all` / a TUI toggle) shows them. Rules out making dismissed work unreachable — the record stays queryable.
- Dismissing does not change pipeline lifecycle state (a running pipeline keeps running; a dismissed-then-resumed pipeline is the operator's choice) — dismissal is orthogonal to state. Rules out coupling dismiss to reject/kill.
- A terminal-publication or in-flight consideration: dismissing a `running` pipeline is allowed but surfaced (it just hides a live one); the plan decides whether to warn. Not a hard block.

## Acceptance criteria

- [ ] `jarvis pipeline dismiss <id>` marks the pipeline dismissed durably; a reload/daemon restart preserves the flag, pinned by a state-store test.
- [ ] `jarvis pipeline list` excludes dismissed pipelines by default and includes them under an explicit opt-in flag, pinned by tests.
- [ ] The TUI work tree and needs-attention segment exclude dismissed pipelines from their default projections, pinned by pure-function tests over those models.
- [ ] `jarvis pipeline undismiss <id>` restores it to the default display, pinned by a test.
- [ ] Dismissing does not alter the pipeline's derived lifecycle state or its stage records, pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the dismiss/undismiss action, that it hides without deleting, and the opt-in to see dismissed pipelines. Cross-link the automatic display-retention seed `pipeline-list-display-retention`.
- `v2/docs/state-store.md` — the durable dismissal column and migration.
- `v2/docs/daemon-host.md` — dismissed pipelines are excluded from default `pipeline_list` projection but retained in durable state.
