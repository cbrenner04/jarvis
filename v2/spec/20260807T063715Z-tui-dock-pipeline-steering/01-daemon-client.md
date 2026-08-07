# Daemon client

## Problem

`TuiDaemonClient` exposes run-level `resume(runId)` but no pipeline mutation RPC seams, so dock dispatch cannot reach `pipeline_approve`, `pipeline_reject`, or `pipeline_resume`.

## Prerequisites

- Subspec `00-command-parser` merged.
- Daemon RPCs `pipeline_approve`, `pipeline_reject`, and `pipeline_resume` are shipped and used by `jarvis pipeline approve|reject|resume`.

## Decisions

- Pipeline mutations use distinct client methods `pipelineApprove`, `pipelineReject`, and `pipelineResume` aligned with wire RPCs — rules out overloading run-level `resume`.
- `pipelineApprove` / `pipelineReject` accept `{ pipelineId, stageId, branchKey }`; `pipelineResume` accepts `{ pipelineId }` — rules out omitting `branchKey` at the TUI boundary.

## Work

- Extend `TuiDaemonClient` and `connectTuiDaemon` with `pipelineApprove`, `pipelineReject`, and `pipelineResume`.
- Add focused `tui-daemon-client.test.ts` coverage that each method issues the matching RPC with parsed params.

## Acceptance criteria

- [ ] `tui-daemon-client.test.ts` proves `connectTuiDaemon` `pipelineApprove`, `pipelineReject`, and `pipelineResume` issue `pipeline_approve`, `pipeline_reject`, and `pipeline_resume` with the expected params; fails against the pre-fix client.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — operator and parity docs land in `03-docs`.
