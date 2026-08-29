# v2 TUI reference

Full rendering and interaction contract for `jarvis tui` and `jarvis tui log`. Operator quick paths (which command to reach for, quiescence checks, recovery) live in [operator-runbook.md § Observe](./operator-runbook.md#observe); this doc is the detailed behavior reference consolidated from the runbook.

## Layout

Split-pane monitor; stacked below 120 columns. The left pane is one unified work tree plus a queue block; the right pane is selection detail; a 4-line dock sits below. In split layout a one-column `│` divider paints between the panes for the full pane band (not the dock), taken out of the right pane's width; stacked layout paints no divider. `[`/`]` nudge the divider.

The left pane has an 80-column floor and otherwise clamps its 45% base at a 50% ceiling: at zero divider offset, 180/200/245-column terminals split left/divider/right at 81/1/98, 90/1/109, and 111/1/133.

## Work tree

One tree orders pipelines (pipeline → stage → run) and ad-hoc `run workflow` invocations (invocations matching no displayed stage) together as top-level rows, followed by a display-only queue block. Top-level ordering: running → awaiting gate (pipelines only; ad-hoc rows are never gated) → terminal. Running and gated rows sort by `createdAt` ascending (an ad-hoc row's `createdAt` is its earliest member run's); terminal rows sort newest finish first (an ad-hoc row's finish is its latest member run's); a terminal row with no finish stamp orders by `createdAt` among terminals.

**Labels.** A pipeline row is labeled with its seed file's basename sans extension, or `<name> <first 8 characters of the pipeline id>` when admitted from seed text (no recorded seed path). A run row is labeled `<role> <8-character run id>`; a collapsed workflow row appends its workflow-step context suffix after that head. An ad-hoc top-level row is labeled with its entry run's branch.

**Fan-out branch nodes.** A fan-out (`downstreamInputs` admitting more than one `branchKey`) splits the subtree: pre-split stages render inline under the pipeline, then one branch node per fan-out `branchKey` in first-encounter order, each followed by that branch's own stages. Branch labels strip the leading `-`-segment run shared by every sibling branch key (capped so each label keeps at least one segment); a lone branch or siblings sharing no leading segment render their full key — the right pane always shows the full unstripped `branchKey`. A branch node summarizes as its first post-split stage not yet `succeeded`/`approved`/`skipped`, or its last stage once every stage settles. The post-split `default` placeholder record every branch superseded renders in neither the tree nor the pipeline's Stages roll-up; the roll-up lists pre-split records first, then one `Branch <branchKey>` group per fan-out branch in first-encounter order.

**Gate rows.** For a pipeline whose `name` matches a registry pipeline definition, an approval-gate stage row renders only while its record is `awaiting` or `rejected` — `pending`, `approved`, and `skipped` gates leave the tree while non-placeholder records stay in the Stages roll-up. `approved` and `rejected` records paint compact gate rows with their outcome and, when `endedAt` is present, decided age. A pipeline whose `name` matches no registry definition elides no gate rows. The intent stage's row appends a `→ N intents` suffix when its record's artifact lists downstream inputs.

**Navigation and expansion.** **`j`** or ↓/↑ walk exactly the currently painted tree in pane order and never widen it — a collapsed pipeline, stage, or branch is one stop, not an entry point into its hidden children; queue rows are display-only and not walk targets. When the tree exceeds pane height the viewport scrolls to keep the selected row visible; there is no pane-side retention or eviction — the daemon's fifty-newest-terminal `list` retention is the only cap. **`e`** toggles expansion for the selected pipeline, stage, or branch node (`▼` expanded / `▶` collapsed) and is a no-op on a run leaf's or ad-hoc row's blank marker; on a selected stage it toggles between collapsed representative run rows and expanded constituent rows. Selecting a descendant reveals ancestor rows for paint (a run under a branch reveals its pipeline and branch, not sibling branches) without persisting expansion; moving selection off a selection-revealed descendant collapses that subtree back out of the painted tree immediately. **`e`** and the `expand`/`collapse` dock verbs are the only durable expansion controls. Reveal-on-select stops at a branch node without expanding sibling branches.

## Row rendering

Every work-tree row composes as `indent · marker · fill label · right-aligned cluster`: two columns of indent per depth, a one-glyph marker (`▼` expanded structural node, `▶` collapsed, blank for leaves), a label padded or ellipsized to fill the remaining width, and a right-aligned cluster of status/liveness/elapsed atoms. A run/ad-hoc row's liveness atom paints `live` only when the row's `isLive` is `true`; every not-live run or ad-hoc row omits the liveness atom entirely rather than painting a not-live word, so its cluster is `status, elapsed`. A pipeline row's cluster can carry `✋<n>` (awaiting-gate count) and `✗<n>` (failed count) from that pipeline's own records. The selected row paints inverse across its complete padded width — indent, marker, label fill, and every cluster atom — never a `>` caret or a label-only highlight; status and liveness tones survive under inverse. Below a row's supported-width floor, or when the cluster does not fit, cluster atoms drop right-to-left (most-droppable first) down to the never-dropped compact status; if even that does not fit, the row falls back to one clipped, unpadded line.

## Timing

**Pipeline and branch aggregates.** Timing sums every member stage interval independently, including overlaps: an ended stage uses `endedAt`, a `running` stage uses the local display clock, and null-start, reversed, future, or non-running open intervals add zero. Last activity is the latest stage `startedAt`, `endedAt`, or `decidedAt`, plus `finishedAtMs` from retained attributed run rows; run finishes are best effort because daemon retention may evict terminal rows, and creation/admission/refresh time is never substituted. A pipeline hides idle only while its own derived state is `running`; a branch hides idle when any of its member stage records — not just its summary record — is `running`; every other case shows idle since durable activity when available.

**Timing cell forms.** Pipeline and branch timing use one shared 80-column left-pane threshold. At 80 columns or more the 20-column cell is `work <duration> · idle <duration>` (or work alone), right-clipped to fit on overflow (costs at most a label character, never a duration digit). Below that it is the eight-column `w<duration>/i<duration>` form; when the paired value overflows it re-renders as `w<duration>/i…` — full work value, idle elided — left-aligned to fill the cell, distinct from the running form's plain right-aligned `w<duration>`. The timing cell never drops work within its rendered string, but the cluster can still drop the whole timing atom during width degradation. Branch rows share this behavior via the same formatter. Durations are nonnegative whole-unit seconds, minutes, hours, or days and always include zero. Stage-row timing keeps its own threshold.

**Leaf elapsed.** Stage leaves keep the existing elapsed formatter, which freezes only once a stage's record carries a recorded `endedAt`; an open stage keeps growing with the display clock. A `failed` stage with a null `startedAt` is the one exception: its leaf elapsed reads `failed before start` in the normal-width tree, the Stages roll-up, and Stage detail, or the eight-column `failed!` in the compact tree; every other null-start stage (`skipped`, `interrupted`, an awaiting/rejected gate, or a malformed `succeeded` record) paints a blank leaf elapsed.

**Run/ad-hoc group elapsed.** Grows with the display clock from a group's earliest retained member admission while any member is active, and freezes once every retained member is terminal at the group's latest retained finish, or its latest retained admission when none finished. A finishless standalone terminal row shows zero elapsed at its own admission (never blank or display-clock growth); corrupt/reversed boundaries clamp to zero; a capped/evicted member never contributes an unobserved finish or admission.

**Detail-pane timestamps.** Pipeline detail renders `createdAt` and `finishedAtMs` as UTC ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`, whole seconds, no fractional seconds or local offset), labels their created-to-display-or-finish duration `wallClock`, and adds work plus applicable idle. Stage detail renders `startedAt`/`endedAt` the same way and also paints `decidedAt`, the absolute approval-decision instant — distinct from the `decided=` gate-age rollup, which stays a relative duration off `stage.endedAt`. A `null` absolute timestamp paints no row; a non-finite or out-of-range value paints `"invalid"` instead of crashing the pane. `wallClock`, elapsed, and work/idle stay relative durations. The local display tick advances running stage/run/pipeline work and non-running idle without `list` or `pipeline_list`; completed and parked work stays fixed, and wall clock freezes only at pipeline finish.

## Stage-entry resolution and branch attribution

**Stage-entry resolution.** A durable stage's `workflowInvocationId` is its admitted entry run ID. Observe resolves that ID against the full retained run set and reads the entry row's workflow invocation before joining runs, building branch claims, deriving project/timing, or suppressing ad-hoc rows. A queued or hidden entry row may resolve without rendering; an unretained or workflow-metadata-less entry leaves the stage unresolved and claimless. TUI fixtures for a resolved association must use distinct entry-run and workflow-invocation IDs.

**Branch-aware stage attribution.** A run's `(project, branch)` pair — not its branch alone — decides tree placement: if it matches a currently-listed pipeline stage's own joined `(project, branch)`, the run's whole workflow invocation (every member run, not only the matching one) nests under that stage and never also paints as a top-level ad-hoc row. Ad-hoc rows are exactly the invocations matching no displayed stage of any pipeline. A blank branch, an invocation-less run, or an invocation claimed only by a dismissed (hidden) pipeline's stage is never branch-attributed. When two currently-listed stages (concurrent or resumed pipelines) share one `(project, branch)`, the most-recently-started stage claims the run. A branch-attributed run's attention row reads `where` as its pipeline/stage target, not its own git branch.

## Needs-attention segment

Above the work tree, `jarvis tui` pins the operator's actionable queue. Sources: awaiting gates, rejected gates, failed stages, failed runs, blocked runs, and terminal-publication failures (skipped/interrupted/killed/budget-soft-stopped statuses never appear). Gates surface regardless of age; a terminal incident surfaces only when its durable timestamp is within the last 12 hours, and a terminal incident with no durable timestamp never surfaces. Stale terminal incidents age out on their own — there is no manual dismiss action.

Each row paints selection marker, glyph (`✋` gate, `✗` failure), `what`, `where`, and `idle <age>` only when the incident has a durable timestamp — a legacy row with no durable timestamp paints no age. Rows sort gates before failures, gates newest-reached-first and failures oldest-idle-first within their own group, then undated rows (gates only, since undated terminal incidents are suppressed) by target then row id. Gates are exempt from the row cap — every unresolved gate always renders and stays selectable, so the current gate is never buried behind a stale gate backlog; the cap bounds only failure rows, at six selectable failure rows. The heading `── Needs attention (N) ──` reports the pre-cap total of the surfaced (post-recency-filter) set, and a display-only `+N more` line follows the rows only when failures exceed the cap — the overflow line is never selectable. No actionable incident paints no heading, row, or overflow line and reserves no left-pane height.

Below the attention segment, a ruled `── Work (N) ──` heading paints directly above the work tree with no blank spacer whenever the complete work-tree model (every pipeline/ad-hoc top-level row plus their nested stage/run rows, unaffected by pane height or scroll) is non-empty, where `N` is that complete model's depth-zero row count; a genuinely empty model paints no Work heading, matching the tree's own "No runs." fallback. Reservation order is attention segment, then the Work heading, then the work-tree viewport, then the Queue segment; the tree budget is `max(0, paneHeight − painted attention rows − Work heading row − queue reservation)` and never goes negative, and the full flattened tree is unaffected. The Queue segment paints a ruled `── Queue (N) ──` heading (queued-row count) directly above queued rows with no blank spacer; queued rows stay oldest-first with their admission descriptor. An empty queue paints no Queue heading or rows and reserves no left-pane height. A non-empty model still paints the Work heading even when the resulting clipped tree-row budget is zero. On a pane too short for the complete segment, Ink clips the ordered heading/rows/overflow prefix at pane height and the tree paints zero rows that refresh — the capped attention selection set stays independent of that paint clipping.

`monitorSelectableNodeIds` prefixes the attention row ids (every gate plus at most six failure rows) before every full-flatten work-tree row id — `j`/↓/↑ and `selectNode` reach them first, in paint order, and the overflow line is never reachable. Selecting an attention row keeps its own id selected (not aliased to its target) and clears retained steering feedback like any other selection, without writing stored `leftPaneTreeScrollOffset` or explicit `expandedPipelineNodeIds`. The right-pane detail maps an attention selection to its target node id, then resolves against the complete joined pipeline/ad-hoc model rather than the painted or expansion-flattened tree, so an attributed run resolves its detail even with collapsed ancestors, and an ad-hoc group target resolves even when the failed run is not the group's representative.

`approve` and `reject` act in place on a selected `awaiting-gate` attention row: dispatch resolves the gate from the row's own `pipelineId`/`stageId`/`branchKey`, not by parsing the attention id or rediscovering the target stage. Selecting any other attention row kind (`rejected-gate`, `failed-stage`, `failed-run`, `blocked-run`, `publication-failure`) and issuing `approve` or `reject` reports `not_awaiting_stage` and issues no RPC; an `awaiting-gate` row whose pipeline has lost its owning daemon reports `stale_non_targetable` and issues no RPC.

**Enter reveal** is a tree-focus key binding, not a typed verb. Unmodified Enter on a selected attention row moves selection to that row's target via the same path as `selectNode` — expanding the target's ancestors implicitly (`resolveSelectedAncestors`) and scroll-following, without writing stored `expandedPipelineNodeIds`, and clearing retained steering feedback like any other selection change. A target absent from the selectable set (the collapsed non-representative run-member case) is a no-op; selecting a non-attention row leaves Enter with nothing to reveal. The `Enter reveal` dock hint appears only while an attention row is selected in tree focus; command-focus Enter still submits. Tree-focus Shift+Enter is inert on terminals that report Shift separately; on terminals that send bare `\r` for Shift+Enter it arrives as plain Enter and reveals.

## Right pane

The right pane separates `Pipeline`, `Stages`, selection-specific `Stage` / `Branch` / `Run`, `Artifact`, `Workflow`, and retained steering-feedback sections with blank rows. An empty section paints no heading; `null`, `undefined`, or empty-string detail fields paint no row while `false` and `0` do; empty roll-up fields are omitted. A recognized stage artifact paints `specPath`, entry run, workflow invocation, PR number and URL, requested and resolved publication bases, and one downstream intent path per line; every other artifact shape paints as indented multi-line JSON, while an absent artifact paints no section.

Pipeline context and stage roll-up show for a pipeline, followed by the selected durable-stage record for a stage (keyed by stage id and branch key, so two branches sharing a `stageId` show distinct records), pipeline context plus the full branch key for a branch node, or selected durable-run workflow/outcome/error/PR/worktree detail for a selectable run; an ad-hoc row shows only its selected durable-run detail, with no pipeline context.

Rows losslessly hard-wrap by display columns — split right-pane width (one column narrower than the left/right split, reserved for the painted `│` divider) or stacked terminal width, floored at one — with no ellipsis and preserved tones; extended grapheme clusters stay atomic, so a wider grapheme can overflow a narrower row.

## Dock

The dock always occupies four physical rows: status, cursor-bearing input, input continuation (kept even when empty), and contextual hints.

**Status counts.** Status begins `N running · N awaiting gate · N failed · N done`, counting one item per distinct retained pipeline ID and one per genuine ad-hoc workflow group or standalone row. Pipeline snapshots merge deduped by id across discovered sockets before classification: the merge-level winner among live sockets is finished-then-progress-then-socket-path (disconnected sockets are evicted first), so a transient multi-daemon window paints and counts each pipeline once. A reachable undecided gate is `awaiting gate`, other pending or active work is `running`, success is `done`, and rejection, failure, or interruption is `failed`. An ad-hoc group is `running` when any member is active or its workflow rollup is non-terminal, `done` only for a fully terminal completed rollup, and otherwise `failed`; ad-hoc work is never `awaiting gate`. Workflow invocations matched to pipeline stages count only through their pipeline; queued rows remain Queue-only and contribute to no status count. All four counts stay leftmost before invoking `profile@socket-digest`, refresh, and both retained feedback channels — `· error: <rpc-error>` first, then `· result: <command-result>` — so right truncation removes metadata and feedback before primary work status. Neither feedback channel hides the other. Discovery, connection, `list`, and `pipeline_list` failures retain last-good rows and snapshots; only a fully successful refresh clears the error, and refresh never clears a retained command result. Retained rows without a live client cannot be killed until ownership reconnects.

**Input.** Input is sanitized and windowed across its two display-width-bounded rows so the cursor stays visible without changing the buffer. From tree focus, `:` or `/` focuses the retained buffer without inserting the shortcut. Printable input inserts at its grapheme cursor; Left/Right move it, Backspace/Delete remove whole graphemes, and `Esc` restores tree focus without clearing or moving it. Enter parses and dispatches the buffer. On terminals that report Shift separately (for example kitty), Shift+Enter is ignored; on most terminals Shift+Enter sends bare `\r` and submits like Enter. Pasted CR/LF are stripped rather than creating newlines. Ctrl-C always quits; other Ctrl/Meta input is ignored. While command-focused, tree navigation, expansion, divider, kill, show-dismissed, and `q` bindings are suppressed. Tree hints add expansion, kill, Enter reveal, and the static **`D dismissed`** toggle; command hints advertise only `Esc` and Enter.

## Dock commands

Ten live verbs. Enter parses the buffer exactly once and switches on the result.

| Command | Form | Effect |
| --- | --- | --- |
| `start` | `start <project> --seed <path>` or `start <project> --seed-text "<text>"` | Detached `pipeline_start` through the same admission seams as `jarvis pipeline start` |
| `expand` | `expand` (no arguments) | Adds the selected pipeline or stage to the expanded set |
| `collapse` | `collapse` (no arguments) | Removes the selected pipeline or stage from the expanded set |
| `approve` | `approve` (no arguments) | `pipeline_approve` for the selected awaiting stage or awaiting-gate attention row |
| `reject` | `reject` (no arguments) | `pipeline_reject` for the selected awaiting stage or awaiting-gate attention row |
| `resume` | `resume` (no arguments) | `pipeline_resume` for the selected non-terminal pipeline |
| `kill` | `kill` (no arguments) | `kill` on the selected live attributed run leaf |
| `pause` | `pause` (no arguments) | `pause` on the selected live attributed run leaf |
| `resume-run` | `resume-run` (no arguments) | `resume` on the selected attributed run leaf |
| `log` | `log` (no arguments) | In-process log follow for the selected run (`selectedRunIdFromState`); tears down the monitor and does not return |

`expand` and `collapse` are **explicit, not toggles** — unlike the `e` key, which toggles. A command that matches the current state succeeds and changes nothing, so `expand` twice is safe. Both are local state edits; neither contacts the daemon. Argument-bearing `expand foo` is rejected as `unexpected_arguments`.

**`approve` / `reject` / `resume` are detached pipeline steering.** Each issues one daemon RPC with no `pipeline_wait`. `approve` and `reject` require an **awaiting** stage selection, or a selected `awaiting-gate` attention row, and send `(pipelineId, stageId, branchKey)` from that row or from the attention row's own gate identity. `resume` requires a **non-terminal pipeline** selection (not a stage or run leaf). On `awaiting-approval` pipelines, `resume` is dock-eligible but only claims continuation — it does not approve the gate or dispatch later stages; use `approve` / `reject` on the awaiting stage, then `pipeline wait`. Track progress in the tree or with `jarvis pipeline list` / `jarvis pipeline wait`.

**`kill` / `pause` / `resume-run` are detached run steering.** Each issues one daemon `kill`, `pause`, or `resume` RPC on the selected attributed run leaf through its owning daemon — same path as the `k` key and other keybind steering, with no `wait` RPC. `kill` and `pause` require a live steerable run (`isLive`, active status, and `actionableRunIds` when present). `resume-run` maps to daemon `resume` and shares keybind resume eligibility — no kill-hint pre-gate, so killed or paused retained rows remain eligible. Pre-RPC selection failures report on `lastCommandResult`; RPC outcomes and daemon refusals report on `steeringFeedback`. Typed steering (`pause`/`kill`/`resume`/`approve`/`reject`) refuses an ad-hoc row selection with the `unattributed` code and a branch node selection with `not_awaiting_stage` (approve/reject) or `not_pipeline` (resume) — first-class navigation and inspection for ad-hoc rows and branch nodes do not extend to steering them directly.

**`log` opens in-process log follow.** Eligible `log` tears down the monitor and enters the same `runTuiLogFollow` path as `jarvis tui log <run-id>` (owner discovery across live keyed daemons, tail resume, operator quit exits `jarvis tui`). Requires a selected run row (`selectedRunIdFromState`); pipeline, stage, and stale or evicted run ids absent from `state.runs` are ineligible. Ineligible `log` reports on `lastCommandResult` and retains command focus, buffer, and cursor.

**`start` is detached.** The TUI issues one `pipeline_start` and no `pipeline_wait`, so it never attaches to completion — admitted means admitted, not finished. At most one admission is in flight; a second Enter while pending is ignored and issues no second parse or admission. Buffer edits and tree navigation stay available while it is pending, and a settlement that arrives after you have typed or navigated does not clobber the newer state.

**Outcomes.** An admitted `start` reports the pipeline id in `result:`, clears the buffer and cursor, and restores tree focus. A successful `approve`, `reject`, or `resume` reports the `pipelineId` in `result:` and likewise clears the buffer, cursor, and restores tree focus. A successful `expand`/`collapse` clears the buffer and cursor. Failures — parse errors, pre-admission failures, ineligible pipeline-steering or expansion selections, and daemon refusals — **retain command focus, buffer, and cursor** so the input is repairable, and report their named code; a `start` daemon refusal preserves the daemon's `detail` verbatim, and `approve` / `reject` / `resume` daemon refusals preserve the daemon's `reason` verbatim (RPC transport errors use `code: message`).

**Expansion feedback codes** (nothing changes when one fires):

| Code | Meaning |
| --- | --- |
| `no_selection` | No selectable row is selected |
| `run_leaf` | The selected row is a nested run leaf |
| `unattributed` | The selected row is an unattributed run |
| `stale_non_expandable` | The selected id is absent from the current expandable tree |

**Pipeline steering feedback codes** (nothing changes when one fires):

| Code | Meaning |
| --- | --- |
| `no_selection` | No selectable row is selected |
| `run_leaf` | The selected row is a nested run leaf |
| `unattributed` | The selected row is an unattributed run |
| `stale_non_targetable` | The selected pipeline or stage has no live owning daemon in the current refresh — retained rows only; also fires when a registry-named pipeline's selected gate stage has been elided from the tree (decided or never reached), or when a selected `awaiting-gate` attention row's pipeline has lost its owning daemon |
| `not_awaiting_stage` | `approve` / `reject` require an awaiting stage or awaiting-gate attention row selection — reachable only via a still-rendered gate row or an `awaiting-gate` attention pin, so this never fires for an elided registry-pipeline gate (that case reports `stale_non_targetable` instead) or for a `rejected-gate`/`failed-stage`/`failed-run`/`blocked-run`/`publication-failure` attention row |
| `not_pipeline` | `resume` requires a pipeline row, not a stage |
| `terminal_pipeline` | `resume` refuses terminal pipeline rows |

**Run steering feedback codes** (nothing changes when one fires; reported on `lastCommandResult`):

| Code | Meaning |
| --- | --- |
| `no_selection` | No selectable row is selected |
| `unattributed` | The selected row is an unattributed run |
| `stale_non_expandable` | The selected id is absent from the current tree or is a pipeline/stage row |
| `not_live_run` | `kill` / `pause` require a live steerable attributed run leaf |

**Log follow feedback codes** (nothing changes when one fires; reported on `lastCommandResult`):

| Code | Meaning |
| --- | --- |
| `no_selection` | No selectable row is selected |
| `not_a_run` | `selectedNodeId` is set but `selectedRunIdFromState` is null (pipeline, stage, or stale/evicted run id absent from `state.runs`) |

An empty or whitespace-only buffer reports `malformed_input`; any other verb reports `unknown_verb`. Malformed `start` input reports the specific code — `missing_project`, `missing_seed_choice`, `missing_seed_value`, `both_seed_flags`, `duplicate_seed_flag`, `unknown_option`, `extra_positional` — and unbalanced quoting reports `unterminated_quote`.

## Dismissed rows

Dismissed pipelines and dismissed runs are both hidden by default. Press **`D`** in tree focus to show them for this session only — the one toggle covers runs and pipelines together, re-requesting both `list` and `pipeline_list` with `includeDismissed: true`; dismissed rows paint with a `(dismissed)` marker, and **`D`** again hides them without waiting for snapshot eviction (including rows retained from an earlier list result or in flight during a toggle-off refresh). The toggle is not persisted; every new monitor session starts hidden. `jarvis tui log <run>` resolves a dismissed run's owning daemon regardless of the toggle. Dismiss via `jarvis run dismiss` / `jarvis pipeline dismiss` (see [operator-runbook.md](./operator-runbook.md#pipeline-dismiss-and-undismiss)).

## Cross-daemon observation

`jarvis tui` and `jarvis tui log` are the primary observation surfaces for multiple daemon instances. When dispatch moves to a new digest (via recompiled executable), the TUI automatically discovers and displays runs from both the old (superseded) and new (superseding) daemons on its next refresh tick, with no restart. Once the old daemon exits naturally, its runs are removed and the monitor continues uninterrupted. `jarvis run list` queries every live keyed daemon under `JARVIS_HOME` and merges their run lists, deduping by run ID and preferring rows marked `isLive` by the owning daemon — a merge does not blind `run list`, `run log`, or `run wait` after digest transitions.

`jarvis tui log <run-id>` auto-discovers the run's owner daemon across all live instances: it discovers live sockets, queries each daemon's run list to locate the owner (preferring live runs), and tails from that owner.

**Transport loss recovery in `jarvis tui log`:** on a mid-stream transport loss (daemon restart, network hiccup), the tail automatically re-opens against the live owner socket and resumes from the last appended record sequence, with no duplicate or lost records and no operator action. If reconnection attempts are exhausted (default: 5 retries with exponential backoff, 100 ms to 2 s), the session shows `tail_resume_exhausted` error feedback and exits with code 1. Operator quit during a retry wait returns cleanly with exit code 0.

The invoking-socket client (the socket the TUI connects to by default via `deps.socketPath`) is not exempt from eviction: when that connection's `list()` RPC fails, the stale client is closed and removed, allowing a fresh connection on the next refresh tick — so if the invoking daemon dies and a new daemon binds the same socket path, the TUI automatically reconnects to the new daemon's runs.
