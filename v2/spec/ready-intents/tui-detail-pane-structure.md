---
name: tui-detail-pane-structure
---

# TUI detail pane: sections, branch-grouped stage roll-up, semantic artifacts

Single intent: every change lands in the TUI right-pane renderer (`v2/src/tui/tui-monitor-lines.ts`), which reads the already-projected snapshot shape, so no second module-boundary surface is touched and splitting does not apply.

## Problem

The right pane is a flat `key: value` dump: nulls included, no blank lines between the pipeline block, the stage roll-up, and selection detail, and the roll-up lists every stage × branch in position order including dead post-split `default` placeholders. The artifact renders as single-line JSON, so `downstreamInputs` — which *is* the intent split and the most decision-relevant fact on screen — is the least readable line. Dogfooding: the operator asked for space between the always-shown block and the stage-specific block, and for the artifact "even if it is just to display the json in a prettier format".

## Decisions

- Sections are separated by blank lines under plain headings: identity (pipeline or run), `Stages`, then selection-specific detail (`Stage` / `Run`) — rules out one undifferentiated list.
- Fields whose value is null, undefined, or empty are suppressed pane-wide — rules out keeping `finishedAtMs: null` rows so every selection paints a fixed row set.
- The stage roll-up is grouped like the tree: pre-split stages, then one block per branch headed by the full `branchKey` (the tree's stripped label expands here) — rules out position order.
- Post-split `default` placeholder stages are omitted from the roll-up — rules out listing skipped rows for record completeness.
- Elided-in-tree gates appear in the roll-up compactly with outcome and decided age; age is dropped when the stage carries no decision timestamp — rules out blocking this work on the terminal-timestamp wire change.
- Known intent-stage artifacts render semantically; unknown shapes fall back to indented multi-line JSON — rules out single-line `stableJson` for display.

## Acceptance criteria

- [ ] Pipeline selection renders identity, `Stages`, and selection sections separated by blank lines, and a null-, undefined-, or empty-valued field produces no row; a `tui-monitor-lines.test.ts` test naming that shape fails against the pre-fix rows.
- [ ] The stage roll-up lists pre-split stages first, then one block per branch headed by the full `branchKey`, with post-split `default` placeholder stages absent.
- [ ] A satisfied gate stage appears in the roll-up with its outcome plus decided age when the stage carries a decision timestamp, and with outcome alone when it does not.
- [ ] A stage artifact carrying `downstreamInputs` renders that intent list one path per line under a label, plus `specPath`, entry run, and PR number/URL and publication-base retarget when present; no single-line JSON remains for that shape.
- [ ] An artifact of unknown shape renders as indented multi-line JSON.
- [ ] Run selection detail keeps every currently shown non-null field and wrapping stays lossless with no truncation of ids or paths (`tui-monitor-lines.test.ts` run-detail and wrapping tests stay green).
- [ ] Mutation checkpoint: in `tui-monitor-lines.test.ts`, a `// @mutate` directive neutering the empty-value suppression filter turns the null-suppression pinning test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe, `jarvis tui` row — detail-pane sections, branch-grouped stage roll-up with gate outcomes, null suppression, semantic artifact rendering and the JSON fallback.
- `v2/docs/v1-behaviors.md` § TUI / observability — record the changed detail-pane shape.

## Prerequisites

- Pipeline snapshots reach the TUI with per-stage `branchKey`, `status`, `startedAt`/`endedAt`, and `artifact`.
- The left-pane tree groups a pipeline's stages into pre-split stages and one subtree per fan-out branch keyed by `branchKey`.
- The tree elides post-split `default` placeholder stages and satisfied gate stages from its rows.
- A gate stage records its outcome as `approved` or `rejected` on the observed stage status.
- A completed intent stage carries an artifact with `entryRunId` and `specPath`, plus `downstreamInputs`, `prNumber`, `prUrl`, and publication-base retarget when present.
- Right-pane rows wrap losslessly at pane width with no ellipsis and no truncation of ids or paths.
