# 01 — CLI renders the blocking stage id and status

## Problem

`pipeline resume` (`v2/src/commands/pipeline.ts`) prints only the bare `reason` for refusals, so operators need `pipeline list --json` to find the blocking row.

## Decisions

- The refusal parser in `pipeline.ts` keeps `stageId` and `status` (string-typed only) on the refused outcome; the daemon handler already returns them on the wire, so no daemon change.
- `branch_not_resumable` renders as `branch_not_resumable: stage <stageId> is <status>`; without `stageId`, `branch_not_resumable: branch is <status>`. Ruled out: printing raw JSON.
- `branch_awaiting_approval` / `branch_rejected` render as `<reason>: stage <stageId>`; ruled out: leaving the runbook's "CLI prints only reason" caveat in place.
- `branch_not_found` and refusals passed through from `reopenFailedPipeline` keep rendering the bare `reason`.
- Missing/non-string `stageId`/`status` fall back to the bare `reason`.

## Acceptance criteria

- [x] A test in `v2/src/commands/pipeline.test.ts` feeds a daemon `branch_not_resumable` response carrying `stageId` and `status` and asserts `pipeline resume <id> <branch>` stderr includes both without `--json`; it fails against the pre-fix bare-reason output.
- [x] A test feeds a `branch_not_resumable` response with `status` but no `stageId` and asserts a readable `branch is <status>` message.
- [x] A test feeds a `branch_awaiting_approval` response with `stageId` and asserts stderr includes the stage id; it fails against the pre-fix bare-reason output (updating the existing verbatim-reason test).
- [x] A test feeds a `branch_rejected` response with `stageId` and asserts stderr includes the stage id; it fails against the pre-fix bare-reason output.
- [x] Tests assert `branch_not_found` and a `reopenFailedPipeline`-passthrough refusal (e.g. `no_failed_stage`) still render the bare `reason`.
- [x] A test asserts a `branch_not_resumable` / `branch_awaiting_approval` response with a missing or non-string `stageId`/`status` falls back to the bare `reason`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` (~line 333) — replace "CLI prints only the daemon `reason` string … not `branchKey`/`stageId`" with the new refusal message shapes; rewrite the `branch_awaiting_approval` passage so it no longer tells operators to look up the gate's stage id via `pipeline list` / `pipeline wait` (the refusal prints it).
- `v2/docs/v1-behaviors.md` (~line 320) — record the CLI rendering of `branch_not_resumable` (`stage <stageId> is <status>`) and of `branch_awaiting_approval` / `branch_rejected` (`stage <stageId>`).
