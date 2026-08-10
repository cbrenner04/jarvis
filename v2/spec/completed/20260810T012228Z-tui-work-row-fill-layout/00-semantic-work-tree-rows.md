# Derive semantic work-tree rows

## Problem

- Tree nodes expose depth and expansion separately from the row content, so a row cannot say whether it hides children or derive pipeline-local attention.
- Branch rows currently have no elapsed source, and missing definitions make approval-stage classification ambiguous.

## Decisions

- A node is expandable exactly when its already-elided structural child collection is nonempty: pipeline `stages` or `branches`, branch `stages`, and stage `runs`. An empty node of an otherwise expandable kind is a leaf, paints a blank marker, and `e` is a no-op.
- The row semantic marker is `▼` when an expandable node is in the effective expansion set, `▶` when it is not, and a blank marker for leaves. Depth is preserved for every flattened node; the reachable 0–3 range maps to `2 * depth` indent columns in the composer.
- Pipeline attention inspects only displayable records from its own snapshot: a `✋` count includes `awaiting` or `rejected` records whose `stageId` resolves to an `approval` stage in that pipeline definition; a `✗` count includes every displayable record with `failed` status. The definition lookup used by gate elision is authoritative.
- Post-split `default` placeholders and satisfied approval records are excluded before attention counting. An unregistered or missing definition yields no gate count, while its failed records still contribute `✗`; empty counts and their separators are omitted.
- A branch elapsed starts at the earliest non-null `startedAt` among its displayable stages, stays empty when none started, advances to `nowMs` until every displayable stage has an `endedAt`, then freezes at the latest such end. Pipeline, stage, and run elapsed sources remain unchanged.
- Pipeline seed/fallback labels, role-first run labels, ad-hoc branch labels, collapsed-workflow suffixes, status tones, and liveness tone remain their existing behavior.

## Tasks

- Attach structural expandability, effective expansion, semantic marker, branch elapsed bounds, and pipeline-local attention to every `MonitorPipelineTreeDisplayNode` before display-width composition.
- Derive attention from the resolved pipeline definition and snapshot records after existing placeholder and gate elision, preserving missing-definition behavior.
- Replace semantic grid assertions with glyph, attention, depth, branch-elapsed, and retained-label tests; retain the injected-input expansion coverage in the interactive slice.

## Acceptance criteria

- [x] Flattened nodes preserve the reachable depths 0–3, structural children alone determine expandability, and expanded/collapsed expandable nodes yield `▼`/`▶` while empty pipeline, branch, and stage nodes yield no glyph and cannot toggle. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` test `derives structural expansion glyphs and pipeline-local attention` fails against the pre-fix row semantics and passes after the change.
- [x] A pipeline's own displayable records render `✋1 ✗1` for one awaiting approval gate and one failed stage, render a rejected approval gate in the same `✋` count, omit empty atoms and separators, ignore another pipeline's records, and do not classify an unresolved definition as a gate while still counting its failed stage. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` test `derives structural expansion glyphs and pipeline-local attention`; Mutation checkpoint: in-body `// @mutate` directives invert every added expansion, definition-resolution, placeholder-elision, and pipeline-local-count guard on its real production condition, with positive and negative cases for each outcome.
- [x] Branch elapsed is empty before any displayable stage starts, advances from the earliest start while work is unfinished, and freezes at the latest end once all displayable stages end. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` test `branch elapsed spans its displayable stage records` fails against the pre-fix branch row and passes after the change; Mutation checkpoint: in-body `// @mutate` directives invert every added start/end aggregation and terminal-freeze guard on its real production condition, with before-start, active, and terminal negative cases.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `derives structural expansion glyphs and pipeline-local attention`; Keystone checkpoint: an in-body `// @mutate` restores the pre-fix no-glyph/no-attention semantic result on the real row-semantic calculation and turns the scoped test red.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` tests `two pipelines of one definition label their rows with distinct seed basenames`, `a pipeline with no recorded seed path labels its row with the definition name and short pipeline id`, `active pipeline stage and run rows render independent elapsed from injected nowMs`, `terminal pipeline stage and run rows freeze elapsed at recorded end times`, and `stage row elapsed is empty when startedAt is null` stay green.

## Documentation updates

- None; row presentation documentation belongs to the composition and interactive slices.
