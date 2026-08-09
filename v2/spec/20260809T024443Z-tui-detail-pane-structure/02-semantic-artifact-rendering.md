# Semantic artifact rendering with a pretty-JSON fallback

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

A completed stage's artifact paints as one `stableJson` line. That line carries `downstreamInputs` — the list of intents a seed split into, the single most decision-relevant fact the pane holds — plus `specPath`, the entry run id, and the PR the stage published, all as unbroken minified JSON that then hard-wraps mid-path across the right pane. Dogfooding ask: render the artifact readably, "even if it is just to display the json in a prettier format".

## Decision ledger

- The artifact becomes its own `Artifact` section inside the `Stage` block rather than a labeled row. Rules out a `key: value` row, which cannot carry a multi-line list.
- A recognized artifact is an object whose `entryRunId` and `specPath` are both strings — the same predicate `pipeline-execution.ts` uses to accept a stage artifact. Rules out keying recognition on `downstreamInputs`, which a completed non-splitting intent stage does not carry.
- A recognized artifact paints every field of `PipelineStageArtifact` — `specPath`, `entryRunId`, `invocationId`, `prNumber`, `prUrl`, `requestedBase`, `resolvedBase`, then `downstreamInputs` — through the existing suppressing `detailRows`, so absent fields cost nothing. Rules out a curated subset, which would silently drop wire fields, and rules out appending a JSON tail for the remainder.
- The publication-base retarget paints as two independent `requestedBase` / `resolvedBase` rows. Rules out one composed `requestedBase → resolvedBase` row, which needs a both-present condition to earn no extra information.
- `downstreamInputs` paints a bare `downstreamInputs` label followed by one two-space-indented row per path; an empty or absent list paints nothing. Rules out a count-bearing label duplicating the tree row's `→ N intents`.
- An unrecognized artifact paints `JSON.stringify(sorted, null, 2)` split one row per physical line, keys sorted at every depth to match `stableJson`'s ordering. Rules out insertion-order `JSON.stringify`, which makes pinned rows depend on wire key order.
- Snapshot artifacts arrive through `JSON.parse`, so the pretty printer needs no non-JSON fallback. Rules out carrying `stableJson`'s `?? String(value)` branch into a path that cannot reach it.
- `failureDetail` keeps its single-line `stableJson` row. Rules out widening this subspec to a second field whose shape no operator ask names.
- Out of scope: sections and suppression (subspec 00), roll-up grouping and gate rows (subspec 01), the left-pane stage label's `→ N intents` suffix.

## Prerequisites

- Subspec 00 has landed: `DetailSection`, `joinDetailSections`, `isEmptyDetailValue`, and a suppressing `detailRows` exist in `v2/src/tui/tui-monitor-lines.ts`, and `stageDetailRows` returns sections.
- `PipelineStageArtifact` in `v2/src/daemon/pipeline-stage-dispatch.ts` declares `entryRunId`, `invocationId?`, `specPath`, `downstreamInputs?`, `prNumber?`, `prUrl?`, `requestedBase?`, and `resolvedBase?`, and `stageArtifactFromEntryRun` is the only writer.
- `pipeline-execution.ts` accepts a stage artifact when `entryRunId` and `specPath` are both strings.
- Stage artifacts reach the TUI as parsed JSON on `PipelineSnapshot["stages"][number].artifact` (`v2/src/persistence/state-store.ts` `JSON.parse`, `v2/src/daemon/pipeline-observation.ts`).

## Tasks

- `v2/src/tui/tui-monitor-lines.ts`:
  - Add a type-only import of `PipelineStageArtifact` from `../daemon/pipeline-stage-dispatch.ts`.
  - Add `function isStageArtifactShape(artifact: unknown): artifact is PipelineStageArtifact` that rejects non-objects and ends `return typeof record.entryRunId === "string" && typeof record.specPath === "string";` — guard-mutation anchor, one physical line.
  - Add `function downstreamInputRows(inputs: readonly string[] | undefined): MonitorLineRow[]` opening `const paths = inputs ?? [];` then `if (paths.length === 0) return [];` (guard-mutation anchor), returning a `downstreamInputs` label row followed by one two-space-indented row per path.
  - Add `function sortJsonKeys(value: unknown): unknown` (recursive; objects rebuilt with `localeCompare`-sorted keys, `undefined`-valued entries dropped) and `function prettyJsonRows(value: unknown): MonitorLineRow[]` returning `JSON.stringify(sortJsonKeys(value), null, 2)` split on newlines into rows.
  - Add `function knownArtifactRows(artifact: PipelineStageArtifact): MonitorLineRow[]` returning `detailRows` for `specPath`, `entryRunId`, `invocationId`, `prNumber`, `prUrl`, `requestedBase`, `resolvedBase` followed by `downstreamInputRows(artifact.downstreamInputs)`.
  - Add `function artifactRows(artifact: unknown): MonitorLineRow[]` opening `if (isEmptyDetailValue(artifact)) return [];` (guard-mutation anchor), then dispatching on `isStageArtifactShape` to `knownArtifactRows` or `prettyJsonRows`, and `function stageArtifactSection(artifact: unknown): DetailSection` returning `{ heading: "Artifact", rows: artifactRows(artifact) }`.
  - In `stageDetailRows`, drop the `["artifact", stage.artifact]` entry, add `const artifactSection = stageArtifactSection(stage.artifact);` (keystone-mutation anchor, one physical line), and append that section after the `Stage` section.
- Tests — `v2/src/tui/tui-monitor-lines.test.ts`:
  - Add `a completed intent stage artifact renders its downstream intents one path per line` — stage selection whose artifact is `{ entryRunId, invocationId, specPath, downstreamInputs: [three paths], prNumber, prUrl, requestedBase, resolvedBase }`; assert the exact `Artifact` section rows, one path per row, and that no row contains `{"`. Carries the `isStageArtifactShape` guard `// @mutate`.
  - Add `an artifact with no downstream inputs paints no downstreamInputs label` — an artifact with `entryRunId` and `specPath` only; assert `specPath` and `entryRunId` rows paint and no row equals `downstreamInputs`. Carries the `downstreamInputRows` guard `// @mutate`.
  - Add `a stage with no artifact paints no Artifact heading` — a stage whose artifact is `null`; assert `Artifact` is absent. Carries the `artifactRows` guard `// @mutate`.
  - Add `an unrecognized artifact shape renders as indented multi-line JSON` — artifact `{ z: 1, a: { z: false, a: "" } }`; assert the `Artifact` section rows are the sorted, two-space-indented `JSON.stringify` lines and that no single row carries the whole object. Carries the keystone `// @mutate`.
  - Rename `stage artifact and failure values preserve JSON omission and falsy semantics` to `stage failure values preserve JSON omission and falsy semantics` and drop its `artifact` arm; the `failureDetail` arm keeps its single-line expectations minus the `null` and `""` cases subspec 00 suppresses.
- Update `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`, and `v2/spec/tui-command-center-brief.md` per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `a completed intent stage artifact renders its downstream intents one path per line` asserts a stage artifact carrying `downstreamInputs` paints an `Artifact` section with one intent path per row under a `downstreamInputs` label plus `specPath`, `entryRunId`, `invocationId`, `prNumber`, `prUrl`, `requestedBase`, and `resolvedBase` rows, and that no row contains minified JSON; it fails against the pre-fix code, which paints one `artifact: {...}` line.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `a completed intent stage artifact renders its downstream intents one path per line`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-lines.ts "return typeof record.entryRunId === \"string\" && typeof record.specPath === \"string\";" -> "return false;"` inside the test body — recognizing no artifact shape, so the intent artifact drops to the JSON fallback and the per-path rows vanish — and the mutation turns that regression RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `an unrecognized artifact shape renders as indented multi-line JSON` asserts an artifact matching no known shape paints as depth-sorted, two-space-indented JSON with one physical line per row; it fails against the pre-fix code, which paints one `stableJson` line.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `an unrecognized artifact shape renders as indented multi-line JSON`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-lines.ts "const artifactSection = stageArtifactSection(stage.artifact);" -> "const artifactSection = { rows: detailRows([[\"artifact\", stage.artifact]]) };"` inside the test body — returning the artifact to one single-line `stableJson` row (baseline semantics) — and the mutation turns that regression RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `an artifact with no downstream inputs paints no downstreamInputs label` asserts a recognized artifact carrying no `downstreamInputs` paints its scalar rows and no bare label row; it fails against the pre-fix code, which has no such label at all.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `an artifact with no downstream inputs paints no downstreamInputs label`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-lines.ts "if (paths.length === 0) return [];" -> "if (paths.length < 0) return [];"` inside the test body — emitting the block for an empty list, so a bare `downstreamInputs` label paints with nothing under it — and the mutation turns that regression RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `a stage with no artifact paints no Artifact heading`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-lines.ts "if (isEmptyDetailValue(artifact)) return [];" -> "if (false) return [];"` inside the test body — building rows for an absent artifact, so a `null` artifact paints an `Artifact` heading over a `null` row — and the mutation turns that regression RED.
- [ ] Wrapping stays lossless with no truncation of ids or paths: `v2/src/tui/tui-monitor-lines.test.ts` — `split detail wraps losslessly by display columns without ellipsis` and `one-column detail floors width, preserves zero-column marks, and atomically overflows wide graphemes` stay green with no edit.
- [ ] `v2/docs/operator-runbook.md` § Observe, `jarvis tui` row records the `Artifact` section: recognized stage artifacts paint `specPath`, entry run, workflow invocation, PR number and URL, publication-base retarget, and one downstream intent path per line; every other shape paints as indented multi-line JSON; an absent artifact paints no section.
- [ ] `v2/docs/v1-behaviors.md` § TUI / observability records the artifact section, the `entryRunId` + `specPath` recognition predicate, the sorted-key pretty-JSON fallback, and that `failureDetail` keeps its single-line rendering.
- [ ] `v2/spec/tui-command-center-brief.md` seed table row 7 records `tui-detail-pane-structure` as shipped by this spec directory rather than `seeded`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe, `jarvis tui` row — the `Artifact` section, semantic fields, per-line downstream intents, and the indented-JSON fallback.
- `v2/docs/v1-behaviors.md` § TUI / observability — artifact recognition predicate, semantic field set, sorted-key pretty-JSON fallback, and `failureDetail` unchanged.
- `v2/spec/tui-command-center-brief.md` — seed table row 7 state.
