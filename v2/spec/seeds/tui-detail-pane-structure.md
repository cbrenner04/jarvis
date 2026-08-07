---
name: tui-detail-pane-structure
---

# TUI detail pane structure — sections, branch grouping, semantic artifacts

TUI command-center phase ([tui-command-center-brief.md](../tui-command-center-brief.md)), on `tui-intent-branch-subtree` (branch model). Independent of row anatomy.

## Problem

The right pane is a flat `key: value` dump: nulls included, no blank lines between the pipeline block, stage roll-up, and selection detail, and the stage roll-up lists every stage × branch in position order including dead `default` placeholders. The artifact renders as single-line JSON — `downstreamInputs`, which *is* the intent split and the most decision-relevant fact on screen, is the least readable line. Dogfooding: the operator asked for space between the always-shown block and the stage-specific block, and for the artifact "even if it is just to display the json in a prettier format".

## Decisions

- Sections separated by blank lines with plain headings: identity (pipeline or run), `Stages`, then selection-specific detail (`Stage` / `Run`). Rules out one undifferentiated list.
- Fields with `null`/`undefined`/empty values are suppressed everywhere in the pane. Rules out `finishedAtMs: null` noise.
- Stage roll-up grouped like the tree: pre-split stages, then one block per branch (full `branchKey` as the block heading — the tree's stripped label expands here). Post-split `default` placeholders omitted. Elided-in-tree gates appear here compactly with their outcome and `decidedAt` age (e.g. `approve-intent approved 6d ago`).
- Artifact renders semantically for the known shape: `downstreamInputs` as a labeled intent list (one path per line), `specPath`, `entryRunId`, PR number/URL when present, publication-base retarget when present. Unknown shapes fall back to pretty-printed (indented, multi-line) JSON. Rules out single-line `stableJson` for display.
- Wrapping behavior unchanged (detail pane wraps; ids/paths never truncate).

## Acceptance criteria

- [ ] Pipeline selection renders identity, `Stages`, and selection sections separated by blank lines; a null-valued field produces no row.
- [ ] Stage roll-up pins: pre-split block first, then per-branch blocks keyed by full `branchKey`; `default` placeholders absent; satisfied gates listed with outcome + decided age.
- [ ] An intent-stage artifact with `downstreamInputs` renders the intent list one path per line under a label, plus `specPath` and entry run; no single-line JSON remains for the known artifact shape.
- [ ] An unknown artifact shape renders as indented multi-line JSON.
- [ ] Run selection detail keeps all currently shown non-null fields (no information loss).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — detail-pane sections and artifact rendering.

## Prerequisites

- `v2/src/tui/tui-monitor-lines.ts` — `pipelineContextRows`, `stageDetailRows`, `selectedRunDetailRows`, `detailRows`, `stableJson`
- `v2/src/daemon/pipeline-stage-dispatch.ts` — `stageArtifactFromEntryRun` (known artifact shape)
- Seed `pipeline-terminal-timestamps` — `decidedAt` for gate outcome ages (degrade gracefully when absent)
