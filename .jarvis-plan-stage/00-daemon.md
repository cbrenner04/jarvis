# Daemon

## Problem

The dock submits into an inert handoff, so parsed commands cannot start pipelines or set tree expansion.

## Prerequisites

- `tui-command-parser.ts` returns typed `start`, `expand`, and `collapse` commands plus named errors.
- `admitPipelineStart` owns validated one-request admission and returns before `pipeline_wait`.
- The monitor retains command editor and feedback state, paints four dock rows, and routes focused Enter once through `submitCommand`.

## Decisions

- Parse the submitted buffer exactly once and switch on `TuiCommandParseResult` — rules out Ink verb matching or a second grammar.
- Start admission runs asynchronously after `submitCommand` returns and issues one `pipeline_start` with no `pipeline_wait` — rules out blocking Ink or attaching the TUI to completion.
- An admitted start retains selection, reports the pipeline id, clears buffer/cursor, and restores tree focus only after settlement — rules out focus-and-reveal or clearing pending input.
- Pre-admission and non-refusal admission failures retain command focus/buffer/cursor and report their failure discriminant plus existing detail — rules out unnamed failures or retrying admission.
- A daemon refusal retains command focus/buffer/cursor and preserves admission `detail` unchanged until the existing fixed-row sanitation boundary — rules out rewriting the daemon reason or issuing a second admission.
- Retain command outcomes independently from refresh-owned RPC feedback and keep both observable on the status row — rules out a successful refresh erasing submission feedback or a retained refresh error hiding it.
- `expand` and `collapse` explicitly add or remove the selected pipeline/stage id; an already-matching state succeeds unchanged — rules out implementing either verb through toggle.
- A run, unattributed row, absent selection, or stale non-expandable selection leaves expansion unchanged, reports named feedback, and retains command focus/buffer/cursor — rules out treating unsupported selection as success.
- Approval, rejection, resume, run pause/kill, log follow, history, completion, selection reveal, and pending-submission cancellation remain out of scope — rules out absorbing steering or editor follow-ons.


## Work

- Expose the production detached-admission callback to `runTuiEntry` without moving CLI presentation or waiting into the TUI.
- Replace the inert submission handoff with one typed asynchronous dispatcher for start and local expansion commands.
- Retain command success/error feedback through refreshes and project it with daemon feedback in the fixed status row.
- Add focused entry, command-boundary, projection, and source-mutation coverage.
- Align durable operator, parity, and TUI-overhaul documentation.

## Acceptance criteria

- [ ] `v2/src/tui/tui-entry.test.tsx` adds a submission regression that fails against the inert baseline and proves one valid path-seed or text-seed `start` submission invokes detached admission exactly once with the typed project/seed, returns control while its promise is pending, and keeps render/display updates responsive before settlement.
- [ ] Production TUI admission uses `admitPipelineStart` with the same cwd, config, registry, model, pipeline-resolution, auto-start connection, and `pipeline_start` seams as `jarvis pipeline start`; `v2/src/commands/tui.test.ts` fails against the baseline and pins that wiring without `pipeline_wait` or duplicate pre-admission checks.
- [ ] After admitted settlement, the dock reports the admitted pipeline id, buffer/cursor are empty, focus is tree, and the pre-submit selection is unchanged; no `pipeline_wait` or focus-and-reveal occurs.
- [ ] `v2/src/tui/tui-entry.test.tsx` proves named pre-admission and non-refusal admission failures retain buffer/cursor and command focus, while a daemon refusal preserves its returned detail, performs one admission only, and does not clear or retry the command.
- [ ] `v2/src/tui/tui-entry.test.tsx` proves `expand` and `collapse` idempotently set the selected pipeline or stage membership in `expandedPipelineNodeIds`, clear successful commands, retain selection, and perform no admission.
- [ ] `v2/src/tui/tui-entry.test.tsx` proves absent, run-leaf, unattributed, and stale non-expandable selections report named feedback while leaving expansion, buffer/cursor, and command focus unchanged.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` proves command success/error feedback survives refresh state and remains visible on the fixed status row alongside retained daemon RPC feedback without changing the four-row layout.
- [ ] The pinning tests in `tui-entry.test.tsx`, `tui-monitor-lines.test.ts`, and `tui.test.ts` carry a unique valid `// @mutate` directive for every added or modified guard, including dispatch, async-settlement, selection-eligibility, explicit-expansion, and feedback-precedence conditions; applying each real-source mutation turns its test red, negative cases prove suppressed admission/state changes remain absent, and production has no inversion hook.
- [ ] `v2/docs/v1-behaviors.md` records TUI pipeline admission and local explicit expansion commands, and `v2/spec/tui-overhaul-brief.md` marks command-dock dispatch shipped while steering remains open.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.


## Documentation updates

- `v2/docs/v1-behaviors.md` — TUI admission and explicit expansion commands.
- `v2/spec/tui-overhaul-brief.md` — command-dock dispatch shipped; steering open.
