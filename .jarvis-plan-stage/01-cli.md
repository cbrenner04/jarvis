# CLI

## Problem

`approve`, `reject`, and `resume` are recognized dock verbs but only report `recognized_unavailable` naming CLI equivalents. Operators cannot steer pipeline gates or resume a pipeline from inside `jarvis tui`.

## Prerequisites

- Fan-out order: implement only after merged `tui-remove-waitstate-window-detail`; before `tui-dock-run-steering` and `tui-dock-log-follow`.
- Command parser and dock dispatch exist (`tui-command-parser.ts`, `tui-entry.tsx`).
- Daemon RPCs `pipeline_approve`, `pipeline_reject`, and `pipeline_resume` are shipped and used by `jarvis pipeline approve|reject|resume`.
- Dock status row reports admitted pipeline id or daemon refusal for `start`.
- `jarvis tui` issues no `wait` RPC on selection change.
- The right pane resolves run detail only from selectable runs.

## Decisions

- `approve`/`reject`/`resume` parse as zero-argument dock verbs — rules out positional CLI mirroring (`approve <stage-id> …`) or keeping `recognized_unavailable`.
- Remove `approve`, `reject`, and `resume` from `UNAVAILABLE_COMMANDS` and the runbook CLI-fallback table — rules out stale unavailable pointers after dispatch ships.

## Work

- Extend `TuiCommand` / `parseTuiCommand` for `approve`, `reject`, and `resume`.
- Add pipeline-steering eligibility helpers and async dispatch in `tui-entry.tsx` `submitCommand`, mirroring `start` settlement semantics for success/failure feedback and stale-settlement suppression.
- Extend `TuiDaemonClient` (and test `fakeClient`) with `pipeline_approve`, `pipeline_reject`, and `pipeline_resume` RPC seams.
- Add focused parser, happy-path, ineligible, and mutation-checkpoint tests named in the acceptance criteria.
- Update operator and parity docs.

## Acceptance criteria

- [ ] `tui-command-parser.test.ts` proves `approve`, `reject`, and `resume` parse as commands and no longer return `recognized_unavailable`; the runbook Dock-commands table lists them as live verbs and drops their CLI-fallback rows.

## Documentation updates
