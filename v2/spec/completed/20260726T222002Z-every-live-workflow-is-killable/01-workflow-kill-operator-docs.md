# 01 - Operator docs for workflow kill

## Problem

Operator docs still describe workflow-started runs as rejecting live `kill` and document workarounds
(kill agent tree, `kill -9` daemon) that this feature removes.

## Decisions

- Durable home for live-control semantics remains `v2/docs/daemon-host.md`; walkthrough and runbook
  cross-link rather than restate the full RPC table; rules out duplicating the kill row in three
  places.
- `pause`/`resume` on workflow runs stay documented as unsupported everywhere `kill` is updated;
  rules out implying parity with write-loop pause.

## Tasks

- Update `v2/docs/daemon-host.md` RPC table and § Live controls on workflow-started runs.
- Update `v2/docs/first-workflow-walkthrough.md` § Workflow-started implement kill contract.
- Prune `v2/docs/operator-runbook.md` workflow kill gotchas and agent-tree workaround; keep the
  `daemon stop` / non-workflow deadlock guidance that does not depend on workflow kill refusal.
- Record workflow-started live kill in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `v2/docs/daemon-host.md` documents that `kill` accepts any live workflow-started run and that
      `pause` still rejects workflow rows `run_not_active`.
- [x] `v2/docs/first-workflow-walkthrough.md` no longer states workflow implement cannot be killed
      live; it describes `jarvis run kill <run-id>` for a live workflow run.
- [x] `v2/docs/operator-runbook.md` omits the 2026-07-16 "`run kill` does not work on
      workflow-started runs" gotcha and the direct agent-process-tree workaround; § workflow kill
      and the gotcha list no longer pair "`daemon stop` refused for active runs" with workflow
      `run kill` being impossible or ineffective (headings and body match the live-kill contract).
- [x] `v2/docs/v1-behaviors.md` records that v2 workflow-started runs are killable while live.

## Documentation updates

- `v2/docs/daemon-host.md` — `kill`/`pause` RPC rows and § Live controls on workflow-started runs.
- `v2/docs/first-workflow-walkthrough.md` — § Workflow-started implement live kill.
- `v2/docs/operator-runbook.md` — workflow kill section and gotcha list.
- `v2/docs/v1-behaviors.md` — workflow-started live kill parity note.
