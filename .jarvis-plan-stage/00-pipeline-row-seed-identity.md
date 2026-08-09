# Pipeline rows carry seed identity

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`buildPipelineMonitorTreeRow` paints `snapshot.name` — the registry definition name — so a pane holding six `full-review` pipelines is a column of six identical labels and the only way to learn which seed a row is is to select it and read `seedPath` in the detail pane. The snapshot already carries `seedPath`; the tree just never reads it.

## Decision ledger

- Pipeline row label = the seed file's basename with its final extension stripped. Rules out the definition name (identical across every pipeline of one definition) and the full seed path (blows the 22-column label cell on every row).
- An absent `seedPath`, or one whose basename-sans-extension is empty, falls back to `<name> <short pipelineId>`. Rules out a bare definition name, which still collides across concurrent text-seeded pipelines, and rules out painting an empty label for a dotfile-shaped seed path.
- Short id = the leading 8 characters of the id; `shortMonitorId` lives in `v2/src/tui/tui-shell-layout.ts`. Rules out defining it in `tui-monitor-pipeline-tree.ts` — the dependency runs tree → layout, and subspec 01 needs the same helper for run ids.
- The label is an exported pure `pipelineRowLabel(snapshot)` painted by `buildPipelineMonitorTreeRow`; `MonitorPipelineTreePipelineNode` gains no `label` field. Rules out mirroring the stage-node `label` precedent, which exists only because a stage's suffix depends on data the paint helper cannot reach.
- The detail pane keeps its `name` and `seedPath` rows verbatim. Rules out replacing them with the derived label — the detail pane is where the unabbreviated identity belongs.
- The fixed column grid and the 22-wide label cell are untouched; a longer slug truncates with `…` exactly as today. Rules out bundling the fill-width row rework, which is `tui-work-row-anatomy`.
- Assertions run through the pure builders, not rendered ink frames (`v2/docs/test-writing.md` § TUI test strategy).

## Prerequisites

- `projectPipelineSnapshot` sets `seedPath: pipeline.context?.seedPath`, so a file-seeded admission projects the recorded path and a text-seeded one projects `undefined` (`v2/src/daemon/pipeline-observation.ts`; admission writes at most one of `seed`/`seedPath`, `v2/src/commands/pipeline-start-admission.ts`).
- `buildPipelineMonitorTreeRow` paints the pipeline row's `label` cell from `node.snapshot` (`v2/src/tui/tui-monitor-pipeline-tree.ts`).
- The detail pane already renders `seedPath` in the pipeline context rows (`v2/src/tui/tui-monitor-lines.ts`).

## Tasks

- `v2/src/tui/tui-shell-layout.ts`: add `export function shortMonitorId(id: string): string` returning `id.slice(0, SHORT_MONITOR_ID_LENGTH)` against a module constant of `8`.
- `v2/src/tui/tui-monitor-pipeline-tree.ts`:
  - Import `basename` from `node:path` and `shortMonitorId` from `./tui-shell-layout.ts`.
  - Add `export function pipelineRowLabel(snapshot: PipelineSnapshot): string` whose body is `const slug = basename(snapshot.seedPath ?? "").replace(/\.[^.]+$/, "");` then `if (slug.length > 0) return slug;` (guard-mutation anchor, one physical line) then a return of the `<name> <short pipelineId>` template literal.
  - Paint `label: pipelineRowLabel(node.snapshot),` in `buildPipelineMonitorTreeRow` in place of `label: node.snapshot.name,` — that line is the keystone-mutation anchor and must stay on one physical line.
- Tests — add to `v2/src/tui/tui-monitor-pipeline-tree.test.ts`:
  - `two pipelines of one definition label their rows with distinct seed basenames` — two snapshots with `name: "full-review"` and `seedPath` `v2/spec/seeds/tui-work-row-labels.md` / `v2/spec/seeds/tui-attention-segment.md`; assert the painted `label` cells are `tui-work-row-labels` and `tui-attention-segment` and that they differ. Carries the keystone `// @mutate`.
  - `a pipeline with no recorded seed path labels its row with the definition name and short pipeline id` — one snapshot with `name: "full-review"`, no `seedPath`, and a UUID-shaped `pipelineId`; assert the painted `label` cell is `full-review ` followed by that id's first eight characters. Carries the slug-guard `// @mutate`.
- Update `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md` per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `two pipelines of one definition label their rows with distinct seed basenames` asserts two same-definition pipelines paint their seed basenames sans extension as distinct label cells; it fails against the pre-fix code, which paints the definition name for both.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `two pipelines of one definition label their rows with distinct seed basenames`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "label: pipelineRowLabel(node.snapshot)," -> "label: node.snapshot.name,"` inside the test body — reverting the row label to the definition name (baseline semantics) — and the mutation turns that regression RED.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a pipeline with no recorded seed path labels its row with the definition name and short pipeline id` asserts a snapshot with no `seedPath` paints `<name> <first 8 characters of pipelineId>`; it fails against the pre-fix code, which paints the bare definition name with no id.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a pipeline with no recorded seed path labels its row with the definition name and short pipeline id`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (slug.length > 0) return slug;" -> "if (slug.length >= 0) return slug;"` inside the test body — accepting an empty slug, so a seed-less pipeline paints a blank label instead of the fallback — and the mutation turns that regression RED.
- [ ] Row geometry and every non-label pipeline cell are unchanged: the existing `v2/src/tui/tui-monitor-pipeline-tree.test.ts` tests `pipeline and stage row helpers reserve column widths`, `derives pipeline project from the first joined run and is empty when none joined`, and `active pipeline stage and run rows render independent elapsed from injected nowMs` stay green, as do the `v2/src/tui/tui-ink-monitor.test.tsx` left-pane row tests.
- [ ] The detail pane still reports the pipeline's definition name and full seed path: the existing `v2/src/tui/tui-monitor-lines.test.ts` test `pipeline selection renders complete identity and durable-order stage roll-up`, which asserts the `name:` and `seedPath:` rows, stays green.
- [ ] `v2/docs/operator-runbook.md` § Observe records that a pipeline row is labeled with its seed file's basename sans extension, and that a pipeline admitted from seed text falls back to the definition name plus the first eight characters of its pipeline id.
- [ ] `v2/docs/v1-behaviors.md` § TUI / observability pipeline-tree bullet records the pipeline row label rule and its text-seeded fallback, and that `snapshot.name` and `seedPath` still render unabbreviated in the detail pane.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — pipeline rows are labeled by seed basename sans extension; text-seeded pipelines fall back to definition name plus short pipeline id.
- `v2/docs/v1-behaviors.md` § TUI / observability — pipeline-tree bullet: pipeline row label derives from `seedPath` (basename, final extension stripped), falls back to `<name> <8-char pipelineId>` when absent or empty, and the detail pane keeps the unabbreviated `name`/`seedPath`.
