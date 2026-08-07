---
name: tui-dock-pipeline-steering
---

# Typed dock pipeline steering

## Problem

`approve`, `reject`, and `resume` are recognized dock verbs but only report `recognized_unavailable` naming CLI equivalents. Operators cannot steer pipeline gates or resume a pipeline from inside `jarvis tui`.

## Decisions

- `approve`/`reject` become real dock commands targeting the selected `awaiting` stage's `(stageId, branchKey)` via `pipeline_approve`/`pipeline_reject` — rules out keeping them `recognized_unavailable`.
- `resume` becomes a real dock command targeting the selected non-terminal pipeline via `pipeline_resume` — rules out CLI-only pipeline resume.
- Feedback (admitted decision id or verbatim daemon refusal) lands on the dock status row like `start` — rules out hidden RPC outcomes.
- Ineligible selections report named dock feedback and issue no RPC — rules out silent no-ops.
- Remove these verbs from `recognized_unavailable` and the runbook CLI-fallback table — rules out stale unavailable pointers after dispatch ships.

## Acceptance criteria

- [ ] Typed `approve`/`reject` over a selected `awaiting` stage issue one `pipeline_approve`/`pipeline_reject` for that `(stageId, branchKey)`; a test drives dispatch against a fake daemon client and asserts the RPC and args; an ineligible selection reports named feedback and issues no RPC.
- [ ] Typed `resume` over a selected non-terminal pipeline issues one `pipeline_resume`; ineligible selection reports named feedback and issues no RPC.
- [ ] The parser no longer maps `approve`, `reject`, or `resume` to `recognized_unavailable`; the runbook Dock-commands table lists them as live verbs and drops their CLI-fallback rows.
- [ ] Mutation checkpoint: for each new pipeline-steering eligibility guard, a `// @mutate` directive inside its pinning test body inverting the eligibility check reddens the guard's regression.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — `approve`/`reject`/`resume` are live dock verbs; correct the Shift+Enter claim.
- `v2/docs/v1-behaviors.md` — record in-TUI pipeline steering.

## Prerequisites

- Command parser and dock dispatch exist (`tui-command-parser.ts`, `tui-entry.tsx`).
- Daemon RPCs `pipeline_approve`, `pipeline_reject`, and `pipeline_resume` are shipped and used by `jarvis pipeline approve|reject|resume`.
- Dock status row reports admitted pipeline id or daemon refusal for `start`.
- `jarvis tui` issues no `wait` RPC on selection change.
- The right pane resolves run detail only from selectable runs.
