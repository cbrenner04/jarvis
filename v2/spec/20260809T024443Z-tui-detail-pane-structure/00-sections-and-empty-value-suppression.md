# Blank-line sections and empty-value suppression

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`monitorRightPaneSegmentRows` paints one undifferentiated `key: value` list: pipeline identity, the `Stages` roll-up, and the selection-specific `Stage` / `Branch` / `Run` block run together with nothing between them, so the operator reading a stage selection has to count rows to find where pipeline context ends. Every field paints regardless of value, so a terminal-less pipeline spends a row on `finishedAtMs: null` and an unpublished run spends rows on `terminalPublicationFailure: null` plus label-only `worktreePath` and `prUrl` lines with nothing after the colon. Dogfooding ask: space between the always-shown block and the stage-specific block.

## Decision ledger

- Sections are composed as `{ heading?, rows }` records and joined by one helper; every right-pane branch returns sections rather than flat rows. Rules out sprinkling separator rows at each call site, which is where the double-blank and leading-blank bugs live.
- The pipeline identity section gets the heading `Pipeline`; `Stages`, `Stage`, `Branch`, `Run`, and `Workflow` keep their existing heading text. Rules out leaving identity as the one headingless block, which reads as a preamble rather than a section.
- A section whose body is empty paints neither its heading nor a separator. Rules out a bare `Stages` heading on a stage-less pipeline and rules out a stray blank row where an absent section used to be.
- The separator row carries a single-space segment, not zero segments. Rules out an empty row, which Ink measures as a zero-height box and drops — the pane would gain nothing the change exists to add, and no pure-function test would catch it (`v2/docs/test-writing.md` § TUI test strategy forbids rendered-ink assertions).
- Empty means `undefined`, `null`, or `""`. `false`, `0`, `[]`, and `{}` still paint. Rules out a truthiness test, which would silently drop `isLive: false`, `prNumber: 0`, and `iterationsConsumed: 0` — the rows an operator reads to tell "never published" from "not reported".
- Suppression applies to `detailRows` entries only. Composed rows — the `Stages` roll-up line, the `Workflow` step line's empty `terminalOutcome` — keep their current text here; the roll-up line is subspec 01's shape and the workflow step line is out of scope for this spec.
- Retained steering feedback becomes its own trailing headingless section. Rules out appending it flush against the last `Run` field, which is what makes it read as another run field.
- Out of scope: roll-up grouping and gate rows (subspec 01), artifact rendering (subspec 02), left pane, dock.

## Prerequisites

- `monitorRightPaneSegmentRows` builds `MonitorLineRow[]` through `detailRows`, `pipelineContextRows`, `stageDetailRows`, and `selectedRunDetailRows` in `v2/src/tui/tui-monitor-lines.ts`.
- `wrapMonitorRows` preserves a row whose only segment is a single space and never truncates (`v2/src/tui/tui-monitor-lines.test.ts` wrapping tests).

## Tasks

- `v2/src/tui/tui-monitor-lines.ts`:
  - Add `const SECTION_GAP = " ";` and `type DetailSection = { heading?: string; rows: readonly MonitorLineRow[] }`.
  - Add `function sectionGapRows(index: number): MonitorLineRow[]` whose whole body is `return index === 0 ? [] : [row(untoned(SECTION_GAP))];` — keystone-mutation anchor, one physical line.
  - Add `function joinDetailSections(sections: readonly DetailSection[]): MonitorLineRow[]` opening `const present = sections.filter((section) => section.rows.length > 0);` (guard-mutation anchor) and flat-mapping `present` into `sectionGapRows(index)`, then the heading row when `section.heading !== undefined`, then `section.rows`.
  - Add `function isEmptyDetailValue(value: unknown): boolean` whose whole body is `return value === undefined || value === null || value === "";` — guard-mutation anchor, one physical line.
  - Change `detailRows` to an arrow body `{ if (isEmptyDetailValue(value)) return []; return [row(untoned(...))]; }` — the `if` line is a guard-mutation anchor and must read exactly `if (isEmptyDetailValue(value)) return [];`.
  - Convert `pipelineContextRows` to return `DetailSection[]`: a `Pipeline` section carrying the current identity, project, state, elapsed, timestamp, and terminal-publication rows, then a `Stages` section carrying one row per `snapshot.stages` entry with its text unchanged.
  - Convert `stageDetailRows` and the branch branch to return `DetailSection[]` (`Stage` / `Branch`), and `selectedRunDetailRows` to return `Run` plus, when `run.workflow !== undefined` and its steps are non-empty, `Workflow`.
  - Have `unwrappedRightPaneSegmentRows` build a `DetailSection[]` — including `{ rows: [row(untoned(state.steeringFeedback))] }` when retained and the headingless `No run selected.` section — and return `joinDetailSections(sections)`; `monitorRightPaneSegmentRows` still wraps the result.
- Tests — `v2/src/tui/tui-monitor-lines.test.ts`:
  - Add `pipeline selection separates identity, stage roll-up, and stage detail with blank rows` — stage selection on the existing `detailedSnapshot`; assert the exact row list, with `Pipeline` first, a single `" "` row before `Stages` and before `Stage`, no leading or trailing gap, and no consecutive gap rows. Carries the keystone `// @mutate`.
  - Add `a stage-less pipeline renders no Stages heading` — pipeline selection on a snapshot with `stages: []`; assert `Stages` is absent and no row equals `" "`. Carries the `present` filter guard `// @mutate`.
  - Add `detail rows keep falsy-but-present values` — a run with `isLive: false`, `createdAt: 0`, `iterationsConsumed: 0`, `resumable: false`, `prNumber: 0`; assert all five rows render. Carries the `isEmptyDetailValue` body guard `// @mutate`.
  - Rename `unattributed run detail preserves null and omits only undefined fields` to `unattributed run detail omits null and empty-string fields` and invert it: the `error: null` row and the label-only `project`, `branch`, `worktreePath`, and `prUrl` rows are absent; `prNumber: 0`, `iterationsConsumed: 0`, `resumable: false`, `isLive: false`, `createdAt: 0` are present. Carries the `detailRows` guard `// @mutate`.
  - Update the pinned expectations in `pipeline selection renders complete identity and durable-order stage roll-up`, `stage selection appends the selected durable record with exact branch and stable diagnostics`, and `attributed run detail is resolved only from the selected durable row` for the `Pipeline` heading, the gap rows, and the dropped empty-valued rows (`terminalPublicationFailure: null` and the label-only `worktreePath` and `prUrl` lines). Change no other assertion in those tests.
- Update `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md` per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `pipeline selection separates identity, stage roll-up, and stage detail with blank rows` asserts a stage selection paints `Pipeline`-headed identity, one single-space row, `Stages`, one single-space row, then `Stage`, with no leading, trailing, or doubled gap row; it fails against the pre-fix code, which paints one undifferentiated list.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `pipeline selection separates identity, stage roll-up, and stage detail with blank rows`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-lines.ts "return index === 0 ? [] : [row(untoned(SECTION_GAP))];" -> "return [];"` inside the test body — emitting no separator, so every section runs together again (baseline semantics) — and the mutation turns that regression RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `unattributed run detail omits null and empty-string fields` asserts a run whose `error` is `null` and whose `project`, `branch`, `worktreePath`, and `prUrl` are empty strings paints none of those rows; it fails against the pre-fix code, which paints `error: null` and four label-only rows.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `unattributed run detail omits null and empty-string fields`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-lines.ts "if (isEmptyDetailValue(value)) return [];" -> "if (false) return [];"` inside the test body — suppressing nothing, so the null and empty-string rows reappear — and the mutation turns that regression RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `detail rows keep falsy-but-present values`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-lines.ts "return value === undefined || value === null || value === \"\";" -> "return !value;"` inside the test body — treating every falsy value as empty, so `isLive: false`, `createdAt: 0`, `iterationsConsumed: 0`, `resumable: false`, and `prNumber: 0` all vanish — and the mutation turns that regression RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `a stage-less pipeline renders no Stages heading` asserts a pipeline with no stage records paints no `Stages` heading and no separator row; it fails against the pre-fix code, which always paints the heading.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `a stage-less pipeline renders no Stages heading`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-lines.ts "const present = sections.filter((section) => section.rows.length > 0);" -> "const present = [...sections];"` inside the test body — keeping empty sections, so the bare `Stages` heading and a stray separator paint — and the mutation turns that regression RED.
- [ ] Wrapping stays lossless with no truncation of ids or paths: `v2/src/tui/tui-monitor-lines.test.ts` — `split detail wraps losslessly by display columns without ellipsis`, `stacked detail uses the full terminal width`, `one-column detail floors width, preserves zero-column marks, and atomically overflows wide graphemes`, `wrapping preserves source segment tones across wide and combining characters`, and `wrapping keeps combining, tone, and ZWJ grapheme clusters atomic` stay green with no edit.
- [ ] Run detail keeps every non-empty field: in `attributed run detail is resolved only from the selected durable row` the only pinned rows removed are the label-only `worktreePath` and `prUrl` lines; `runId`, `project`, `branch`, `status`, `isLive`, `createdAt`, `finishedAtMs`, `stepId`, `workflowInvocationId`, the `Workflow` step rows, `loopOutcomeKind`, `iterationsConsumed`, `resumable`, `error`, `reviewPasses`, `reviewBehavior`, `prNumber`, and the retained steering feedback all still paint.
- [ ] `v2/docs/operator-runbook.md` § Observe, `jarvis tui` row records the blank-line-separated detail sections (`Pipeline`, `Stages`, `Stage` / `Branch` / `Run`, `Workflow`, retained steering feedback), that an empty section paints no heading, and that a `null`, `undefined`, or empty-string field paints no row while `false` and `0` do.
- [ ] `v2/docs/v1-behaviors.md` § TUI / observability records the sectioned detail-pane shape and the empty-value suppression rule, including that falsy-but-present values still paint.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe, `jarvis tui` row — detail-pane sections separated by blank rows, headings, empty-section elision, and the empty-value suppression rule.
- `v2/docs/v1-behaviors.md` § TUI / observability — the sectioned detail-pane shape and empty-value suppression (falsy-but-present values retained).
