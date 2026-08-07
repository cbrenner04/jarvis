---
name: tui-slice-6-steering-and-log
---

# TUI slice 6 — steering + log

Final slice of the TUI command-center brief (`v2/spec/tui-overhaul-brief.md`). Slices 1–5 shipped the split layout, pipeline tree, elapsed columns, detail pane, and the command dock with `start`/`expand`/`collapse` dispatch. Slice 6 makes the dock a full operator surface: pipeline and run steering, log follow, the unattributed segment, and it folds in the two slice-4 leftovers.

Author for `intent` fan-out — this is deliberately several independent pieces so plan splits it into small, one-iteration subspecs. Do not send the brief to `plan`.

## Problem

Steering is still CLI-only. The typed dock verbs `approve`/`reject`/`resume`/`kill`/`pause`/`log` all report `recognized_unavailable` naming their CLI equivalent (`v2/src/tui/tui-command-parser.ts:30-35`), even though run-level `pause`/`resume`/`kill` already exist as keybind actions (`runSteeringAction`, `tui-entry.tsx`). An operator cannot approve a gate, resume a pipeline, kill/pause a run, or open a log tail from inside `jarvis tui` — they drop to a second terminal. Two slice-4 leftovers also remain: a per-selection `wait` RPC feeds `waitState`, which nothing renders, and the right-pane detail fallback resolves runs the left pane cannot select.

## Decisions

- **Pipeline steering verbs (`approve`/`reject`/`resume`) become real dock commands**, dispatched through the same daemon RPCs as `jarvis pipeline approve|reject|resume` on the selected pipeline/stage — rules out keeping them `recognized_unavailable`. `approve`/`reject` target the selected `awaiting` stage's `(stageId, branchKey)`; `resume` targets the selected pipeline. Feedback (admitted decision id or verbatim daemon refusal) lands on the dock status row like `start` does.
- **Run steering verbs (`kill`/`pause`/`resume-run`) become real dock commands** that reuse the existing `runSteeringAction` seam on the selected run — rules out a second dispatch path parallel to the keybindings.
- **`log` opens the selected run's log follow** in-process (the same tail `jarvis tui log <run-id>` drives), not a `recognized_unavailable` pointer — rules out leaving log-follow CLI-only. Out of scope: a separate log pane layout; reuse the existing follow entry.
- **Unattributed segment gets FIFO + labelling** consistent with the left-pane retention rule (active never dropped; terminals FIFO by finish time) — rules out an unbounded or unlabelled segment. Out of scope: the pipeline-tree retention rule itself (already shipped).
- **Fold `seeds/tui-waitstate-is-polled-but-no-longer-rendered`**: remove `waitState`/`buildWaitStateForSelection` and the selection-driven `wait` RPC, and window the right-pane run fallback to the same set `monitorSelectableNodeIds` walks. That seed's decisions and acceptance criteria are authoritative for this piece; it is superseded by this slice and retired when this lands.
- **Doc correction**: `operator-runbook.md` § Observe says "Shift+Enter is ignored", but outside kitty-protocol terminals a bare `\r` arrives, so Shift+Enter submits. Correct the claim when the dock is touched.
- Each verb reports a named, testable failure when no eligible selection exists (no `awaiting` stage for approve/reject, no non-terminal pipeline for resume, no live run for kill/pause, no run for log) — rules out silent no-ops.

## Acceptance criteria

Split at plan time; each bullet group is an independently testable subspec.

- [ ] Typed `approve`/`reject` over a selected `awaiting` stage issue one `pipeline_approve`/`pipeline_reject` for that `(stageId, branchKey)`; a test drives dispatch against a fake daemon client and asserts the RPC and args; an ineligible selection reports named feedback and issues no RPC.
- [ ] Typed `resume` over a selected non-terminal pipeline issues one `pipeline_resume`; ineligible selection reports named feedback and issues no RPC.
- [ ] Typed `kill`/`pause`/`resume-run` over a selected live run reach the existing `runSteeringAction` seam (one run RPC each); ineligible selection reports named feedback and issues no RPC.
- [ ] Typed `log` over a selected run opens the same log-follow tail `jarvis tui log <run-id>` drives; no run selected reports named feedback.
- [ ] The parser no longer maps these verbs to `recognized_unavailable`; the CLI-fallback table entries for the now-live verbs are removed and the runbook Dock-commands table updated.
- [ ] Unattributed segment applies the FIFO retention rule (active shown always; terminals oldest-by-finish drop first) and labels the segment with a count; a pure-function test covers the retention ordering.
- [ ] `waitState`/`buildWaitStateForSelection` are gone; `jarvis tui` issues no `wait` RPC on selection change (test asserts zero `wait` calls); the right-pane fallback is windowed to selectable runs so an unselectable run renders `No run selected.`-equivalent detail; mutation checkpoint (inside the pinning test) reverting the fallback to the unwindowed list reddens that regression. (Folds `tui-waitstate-is-polled-but-no-longer-rendered`.)
- [ ] Mutation checkpoint: for each new steering-eligibility guard, a `// @mutate` directive inside its pinning test body inverting the eligibility check reddens the guard's regression.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — approve/reject/resume/kill/pause/resume-run/log are live dock verbs; remove them from the CLI-fallback table; correct the Shift+Enter claim; note the right pane resolves detail only from selectable runs.
- `v2/spec/tui-overhaul-brief.md` — mark slice 6 shipped; note steering and log are now in-dock.
- `v2/docs/v1-behaviors.md` — record in-TUI pipeline/run steering and log follow.

## Prerequisites

- Command parser and dispatch (`tui-command-parser.ts`, `tui-entry.tsx` dispatch + `runSteeringAction`).
- Daemon RPCs `pipeline_approve`/`pipeline_reject`/`pipeline_resume` and run `pause`/`resume`/`kill` (shipped; CLI already uses them).
- Log-follow entry (`tui-log-follow-entry.tsx`, `tui tui log` path).
- `monitorSelectableNodeIds`/`monitorSelectableRuns` (`tui-monitor-lines.ts`) for the right-pane windowing.
