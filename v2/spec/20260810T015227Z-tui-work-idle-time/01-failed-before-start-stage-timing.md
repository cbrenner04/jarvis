# Failed-before-start stage timing

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

A terminal failed stage with no start timestamp appears to have blank elapsed time, indistinguishable from deliberately unstarted or malformed rows.

## Decision ledger

- Only `status: "failed"` with null `startedAt` displays `failed before start` in normal-width tree timing, the pipeline Stages roll-up, and selected Stage detail.
- Null-start `skipped`, `interrupted`, approval, malformed `succeeded`, and every other non-failed stage retain an empty leaf elapsed value; none is relabeled as failed.
- The tree's compact eight-character timing cell renders failed-before-start as `failed!`; normal width uses the complete `failed before start` phrase. Detail always uses the complete phrase.
- Normal started-stage elapsed remains shared across tree, roll-up, and detail; this slice changes only the null-start terminal failure presentation.

## Prerequisites

- Failed-before-start snapshot rows carry `status: "failed"`, numeric `endedAt`, null `startedAt`, and no workflow linkage.

## Tasks

- Add one stage elapsed projection used by tree rows, pipeline Stages roll-up, and selected-stage detail.
- Render the failed-before-start state at normal and compact tree widths without changing non-failed null-start semantics.
- Add regression coverage in `v2/src/tui/tui-monitor-pipeline-tree.test.ts` and `v2/src/tui/tui-monitor-lines.test.ts`.
- Update the failed-before-start portions of `v2/docs/operator-runbook.md` § Observe and `v2/docs/v1-behaviors.md` § TUI / observability.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `a failed stage with no start paints failed before start in tree and detail` fails against the baseline and proves the normal tree row, Stages roll-up, and selected Stage detail say `failed before start`; it also proves the compact tree says `failed!` and skipped, interrupted, approval, malformed succeeded, and other non-failed null-start rows remain blank.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `a failed stage with no start paints failed before start in tree and detail`; Keystone checkpoint: its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (stage.status === \"failed\" && stage.startedAt === null) return \"failed before start\";" -> "if (false) return \"failed before start\";"`, and the mutation turns the regression RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `a failed stage with no start paints failed before start in tree and detail` carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return compact ? \"failed!\" : \"failed before start\";" -> "return \"failed before start\";"`, and the mutation turns the compact-width assertion RED.
- [ ] `v2/docs/operator-runbook.md` § Observe and `v2/docs/v1-behaviors.md` § TUI / observability distinguish failed-before-start from every non-failed null-start stage and record normal versus compact tree wording.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — failed-before-start wording and null-start exceptions.
- `v2/docs/v1-behaviors.md` § TUI / observability — failed-before-start and non-failed null-start behavior.
