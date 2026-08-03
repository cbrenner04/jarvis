# TUI — build brief

Meta-index phase. Operator ordering: [implement-queue.md](implement-queue.md). **Do not send this brief to** `plan` — fan slices with `jarvis run workflow intent`.

Replaces the 2026-07-27 brief. **Status 2026-08-03: slices 1-5 shipped; the dock edits (#2545), dispatches (#2554), and projects both feedback channels on its status row (#2575). Slice 6 (steering + log) is unseeded.** TUI test strategy is settled for the whole phase — rendered-ink assertions are unsupported because CI cannot observe them; prove layout with pure functions, keybindings through the injected input hook, and behavior through production monitor state ([test-writing.md § TUI test strategy](../docs/test-writing.md#tui-test-strategy)). Goal is a **Jarvis command center**: one terminal app to start pipelines in any registered project, monitor them, steer gates and runs, and read enough state to decide without cross-checking CLI output.

## Goal

`jarvis tui` is the primary operator surface for **pipelines**. Runs nest under pipeline stages (and `branchKey` when fan-out is active). Ad-hoc runs without a pipeline parent appear in a separate segment.

CLI remains for scripting; the TUI must reach parity for interactive pipeline operation.

## Layout — command center (reference: 245×72)

Design target is a **full-window** terminal (operator reference: **245 cols × 72 lines**). Layout is **horizontal split + bottom command dock**, not a single vertical scroll. Tree rows use a **fixed-width column grid** (truncate with `…`; never wrap). The **detail pane may wrap** long values.

```
┌─ Pipelines ────────────────-┬─ Detail ─────────────────────────────────────────────-┐
│ ▼ full-review  jarvis       │  Pipeline  full-review                                │
│   running        12m34s     │  id        7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f       │
│   ▼ intent [default]        │  project   jarvis · terminalAction ready              │
│     running      4m02s      │  elapsed   12m34s (created 22:01:03)                  │
│     run abc… in-prog 4m     │                                                       │
│       live  claude          │  Stages                                               │
│   ▶ approve-intent awaiting │  > intent [default]  running  4m02s                   │
│                             │    artifact  v2/spec/…/index.md                       │
│ ▶ other-pipeline  plan      │  · approve-intent  awaiting                           │
│                             │                                                       │
│ ─ Unattributed (0) ─        │  (selection: stage → stage fields; run → run fields)  │
│                             │                                                       │
│  (~94×68 scroll)            │  (~151×68 scroll)                                     │
├────────────────────────────-┴─────────────────────────────────────────────────────-─┤
│ 2 active · home daemon · refresh 1s                                                 │
│ > start jarvis --seed seeds/foo.md                                                  │
│ : approve approve-intent   │  j/k select  e expand  a/r gate  Enter run  ? hints    │
└──────────────────────────────────────────────────────────────────────────────────-──┘
```

### Region geometry

Measured from `stdout.columns` / `stdout.rows` on each render.

| Region                   | Reference size (245×72)             | Role                                                                                                                |
|--------------------------|-------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| **Left — pipeline tree** | **94 cols × 68 lines** (38% width)  | Scrollable pipeline → stage[branch] → run hierarchy; segments for Pipelines, Unattributed, Queue                    |
| **Right — detail**       | **151 cols × 68 lines** (62% width) | Structured detail for the **current selection** (pipeline, stage, or run); workflow steps and errors live here only |
| **Command dock**         | **full width × 4 lines** (fixed)    | Status, input, hints — not scrollable with the panes                                                                |

Split ratio default **38 / 62** (left / right). Session `[` / `]` nudges the divider ±2 cols (floor left 72 cols, ceil left 40% of width) so the tree never disappears.

Below **120 cols** width: fall back to stacked layout (tree above detail, same dock) — reference design is full-window; small terminals degrade.

### Left pane — retention (FIFO)

No time-based window (not the current run monitor's 1h / 20-row cap). The left tree is a **FIFO viewport**:

- **Active** pipelines (non-terminal derived state) are always shown and never dropped.
- **Terminal** pipelines stay until the expanded tree would exceed the pane; then **oldest by finish time** fall off first (FIFO among terminals only). Finish time = derived terminal settle (`terminalPublicationSucceededAt` when present, else stage/pipeline failure or reject timestamp). **Superseded in slice 2 (#2479, #2481, #2485):** navigation-time FIFO eviction made rows permanently unreachable (14 of 30 pipelines lost on a down-and-up walk at 100×24), so flatten now retains every node and the pane paints a scrolling viewport over it. Idle retention of terminal pipelines remains a valid future refinement; navigation-time dropping does not.
- Sort key within the pane: active pipelines top (by `createdAt`), then terminal pipelines below (by finish time, oldest first). New admissions append at the bottom among actives.
- Falling off is **display-only**; store and `jarvis pipeline list` unchanged.
- Unattributed runs and queue segments use the same FIFO rule within their segment.

### Left pane — auto-expand

No strong operator preference — ship the minimum first, add polish if dogfooding asks for it.

**Ship (slice 2):**

- **Reveal on select** — expand ancestors so the selected row is always visible; siblings stay collapsed. **Shipped #2471.** Note the correction: an earlier build also self-expanded the *selected* node, which made `e` a visual no-op on it and broke `j`/`k` reversibility. Reveal is ancestors-only; descending with `j` persists the expansion instead.
- **Post-start focus** — after `start`, select the new pipeline and reveal it (ancestors only; pipeline row visible). Deferred with `start` itself to slice 5.

**Add if cheap during slice 2, else defer:**

- **Active-path expand** — on pipeline select, also open the current stage (first non-satisfied stage in position order, correct `branchKey` under fan-out). Skips succeeded/approved stages unless selected.

**Always:** manual `e` toggles expand on the selected pipeline or stage.

### Left pane — tree columns (245-col reference)

At reference width the left pane (~94 cols) shows **all** scan columns without tiering:

| Col     | Width | Pipeline | Stage     | Run     |
|---------|-------|----------|-----------|---------|
| marker  | 1     | ▼/▶      | ▼/▶       | ·       |
| indent  | 2     | —        | —         | yes     |
| label   | 22    | name     | stageId   | role    |
| project | 10    | project  | —         | —       |
| branch  | 14    | —        | branchKey | branch  |
| state   | 12    | derived  | status    | status  |
| elapsed | 8     | wall     | wall      | wall    |
| live    | 5     | —        | —         | live    |
| agent   | 10    | —        | —         | binding |
| id      | 8     | short    | —         | short   |

Narrower left panes drop columns from the right (agent → id → branch → project) per the width table in § Column degradation; state and elapsed are never dropped.

### Right pane — detail content

**Be generous.** The right pane (~151 cols at reference size) is the command center's information surface — show everything the operator would otherwise grep CLI output for. Wrap long values; never truncate ids, paths, or error text here. Tree columns stay scannable; detail carries the full picture.

**Pipeline context** — pipeline selection shows this identity block and stage roll-up:

- Full `pipelineId`, name, registered project, admitted definition name
- Derived state, pipeline wall-clock elapsed, `createdAt`
- `terminalAction`, seed path/excerpt from admission `context`
- Terminal publication outcome / PR when settled
- Compact stage roll-up (every stage: id, branch when not `default`, status, elapsed)

Selection determines the remaining detail:

| Selection        | Detail                                                                     |
|------------------|----------------------------------------------------------------------------|
| Pipeline         | Pipeline context and stage roll-up only                                    |
| Stage            | Pipeline context and stage roll-up, then the selected durable-stage record |
| Attributed run   | Pipeline context and stage roll-up, then selected durable-run detail       |
| Unattributed run | Selected durable-run detail only                                           |

Queue rows are display-only and cannot be selected.

Empty selection: short welcome + example `start` command; optional registered-project list with configured pipeline names.

### Command dock (4 lines)

| Line | Content                                                                                                           |
|------|-------------------------------------------------------------------------------------------------------------------|
| 1    | **Status** — active pipeline count, daemon profile/socket digest, refresh interval, last RPC error if any         |
| 2    | **Input** — prompt `>` when editing; mirrors CLI grammar (`start jarvis --seed path`, `approve <stage-id>`, …)    |
| 3    | **Input continuation** — fixed second row for windowed/wrapped input; remains present when empty                  |
| 4    | **Hints** — context keybindings for current selection (gate: `a`/`r`; run: kill/pause; global: `:` focus command) |

Activate command focus with `:` or `/`; Esc returns focus to tree. Enter submits; Shift+Enter inserts newline on line 3 when entering multiline seed text.

Pipeline kill/pause: **out of scope** for v1.

Command grammar: **CLI mirror** for v1.

## Information architecture

```
Pipeline  <name>  <project>  <state>  <elapsed>
  stage <id> [<branch>]  <status>  <elapsed>
    run <short-id>  <role/step>  <status>  <live>  <elapsed>  <agent>
```

- Join runs to stages via `workflowInvocationId` (same as CLI mental model).
- **Elapsed** = wall-clock from durable start to now (active) or end timestamp (terminal). See timing below.
- Queued admission rows stay in their own segment; not nested under a pipeline.

**Selection** is three deep: pipeline → stage (branch-scoped when needed) → run. Commands and keybindings apply to the deepest selected node that supports the action.

## Timing (required columns)

Wall-clock duration is a first-class column at **pipeline**, **stage**, and **run** levels.

| Level    | Start                                       | End (terminal)                                              | Active display                 |
|----------|---------------------------------------------|-------------------------------------------------------------|--------------------------------|
| Pipeline | `createdAt`                                 | `terminalPublicationSucceededAt` or derived terminal settle | `now - createdAt`              |
| Stage    | `startedAt`                                 | `endedAt`                                                   | `now - startedAt` when running |
| Run      | `createdAt` (or active attempt `startedAt`) | `finishedAtMs` on list row                                  | `now - start`                  |

`pipeline_list` today omits timestamps and `branchKey` — extend the observation wire before the TUI can render elapsed columns honestly. Run-level `finishedAtMs` already exists on daemon `list`; attempt `startedAt` may need projection for in-progress elapsed within a run.

Refresh every second; elapsed columns tick locally between polls without extra RPC.

## Command line

Commands are entered in the **command dock** (bottom 4 lines). Grammar mirrors CLI for v1.

| Command                         | Example                            | Maps to                                                     |
|---------------------------------|------------------------------------|-------------------------------------------------------------|
| `start`                         | `start jarvis --seed seeds/foo.md` | `pipeline_start` (pre-admission resolution in-process)      |
| `approve` / `reject`            | `approve approve-intent`           | `pipeline_approve` / `pipeline_reject` on selected pipeline |
| `resume`                        | `resume`                           | `pipeline_resume` on selected pipeline                      |
| `kill` / `pause` / `resume-run` | `kill`                             | `run` RPC on selected nested run                            |
| `log`                           | `log`                              | `jarvis tui log <run-id>` for selected run                  |
| `expand` / `collapse`           | `expand`                           | Explicitly add/remove selected pipeline/stage node          |

Keybindings remain for frequent actions (`j`/`k`, `e`, `a`/`r` on gates, etc.). Command dock and keys share one dispatch layer.

## Operator actions

| Selection                    | Actions             |
|------------------------------|---------------------|
| Pipeline (non-terminal)      | Resume              |
| Approval stage (`awaiting`)  | Approve, reject     |
| Constituent run (live owner) | Pause, resume, kill |
| Run leaf                     | Log follow          |

Pipeline kill/pause: **out of scope** v1.

## What exists today

Daemon + CLI: `pipeline start | list | wait | approve | reject | resume`; `run pause | resume | kill | list | log`.

TUI (after slices 1-4): left tree pane / right detail pane / fixed 4-line dock, sized from `stdout` each render with a stacked fallback below 120 cols. The left pane nests `pipeline → stage[branchKey] → run` from polled `pipeline_list` snapshots joined to `list` runs by `workflowInvocationId`, with three-deep selection, `e` expansion, reversible `j`/`k`, scroll-follow, and wall-clock elapsed at all three levels ticking locally between refreshes. The right pane shows pipeline context and stage roll-up for pipeline selection; adds the selected durable-stage record for stage selection; adds selected durable-run detail for attributed runs; and shows only selected durable-run detail for unattributed runs. Rows wrap losslessly by display columns without splitting extended grapheme clusters; a grapheme wider than the effective width remains atomic and overflows that row. The shipped pure dock projection derives fixed status, cursor-bearing input, continuation, and contextual-hint rows from monitor state and bounds each to display width.

Slice 5 has landed six pieces: a pure typed command parser (`tui-command-parser.ts`, #2529), a reusable `pipeline_start` admission API the CLI now goes through too (`pipeline-start-admission.ts`, #2530), the four dock rows as a pure function over monitor state (`monitorDockLines`, #2531), the painted dock plus its session state (#2533), command focus and grapheme-cursor editing driven through the injected input hook (#2545), and dispatch — a submitted `start` reaches `admitPipelineStart` on the same seams as `jarvis pipeline start`, detached, plus `expand`/`collapse` and parse-error feedback (#2554).

Slice 5 is complete: subspec 02 shipped the status-row projection that carries RPC and command feedback together, along with the operator-runbook and parity documentation folded into it (#2573 retired the two documentation-only subspecs). Still missing: there is no steering — approve/reject/resume, run pause/kill, and log follow are all still CLI-only. The unattributed segment renders but has no FIFO or labelling polish.

One doc claim to correct when slice 6 touches the dock: `operator-runbook.md` says "Shift+Enter is ignored", but outside the kitty keyboard protocol terminals send a bare `\r`, so Shift+Enter submits. Harmless while submission was inert; wrong now that dispatch has landed.

## Non-goals

- tmux
- Daemon inventory UI (stay on `daemon status` / `cleanup`)
- Replacing CLI entirely

## Prerequisites

All met as of 2026-08-01.

| Dependency                                                                                                                        | Why                                                                    | State                |
|-----------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------|----------------------|
| Intent fan-out (`20260731T030451Z-pipeline-intent-split-fan-out-execution`)                                                       | Multi-branch stage rows                                                | shipped              |
| Richer `pipeline_list` (`branchKey`, `createdAt`, stage `startedAt`/`endedAt`)                                                    | Nesting labels and elapsed                                             | shipped #2463, #2490 |
| `pipeline_list` diagnostics (`terminalAction`, `seedPath`, publication outcome, stage `id`/`position`/`artifact`/`failureDetail`) | Detail-pane content                                                    | shipped #2511        |
| `terminal-window-renders-finishless-rows`                                                                                         | Terminal nested runs stay visible until FIFO drops the parent pipeline | shipped              |

## Minimum slices

Serialize 1 → 6. Each row is a seed.

| # | Slice               | Delivers                                                                                                       | State                                                                                                             |
|---|---------------------|----------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| 1 | **Shell layout**    | Left/right split + 4-line command dock; fixed-width tree columns; reference 245×72; stacked fallback <120 cols | **shipped** #2453, #2456                                                                                          |
| 2 | **Pipeline tree**   | Poll `pipeline_list` + `list`; join; nested rows; expand/collapse; selection drives right pane                 | **shipped** #2462, #2463, #2466 (+#2471, #2473, #2479, #2481, #2485)                                              |
| 3 | **Elapsed columns** | Wire timestamps; wall clock in tree; local tick between refreshes                                              | **shipped** #2490, #2492                                                                                          |
| 4 | **Detail pane**     | Structured right-pane content per selection depth; workflow steps and errors                                   | **shipped** #2511 (wire), #2519, #2521                                                                            |
| 5 | **Command dock**    | 4-line dock; CLI-mirror parser; `start` admission; dispatch                                                    | **shipped** — #2529 parser, #2530 start admission, #2531 dock rows, #2533 painting, #2545 editor, #2554 dispatch, #2575 status-row projection |
| 6 | **Steering + log**  | Approve/reject/resume; run pause/kill; log follow; unattributed segment                                        | open                                                                                                              |

Follow-ons (not blocking): PR/publication blocks in detail; column-divider resize polish.

## Column degradation (left pane width)

When the left pane is narrower than the reference (~94 cols), drop columns from right to left:

| Left pane width | Visible tree columns               |
|-----------------|------------------------------------|
| ≥ 90            | full set (see layout table)        |
| 72–89           | drop agent, short id               |
| 58–71           | drop branch                        |
| 48–57           | drop project                       |
| < 48            | marker, label, state, elapsed only |
