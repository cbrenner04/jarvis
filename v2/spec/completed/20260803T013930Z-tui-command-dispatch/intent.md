---
name: tui-command-dispatch
---

# TUI command submission and dispatch

## Problem

Editing alone cannot start a pipeline or apply explicit expansion state. Submission needs one non-blocking dispatcher that consumes the typed language and reports outcomes in the dock.

## Decisions

- Parse once on submission and dispatch typed commands through monitor controls — rules out verb matching in ink or multiple parsers.
- Dispatch `start` through the reusable admission API in detached mode and update state after the promise settles — rules out duplicate pre-admission logic and render-loop blocking.
- Dispatch `expand` and `collapse` as explicit selected-node states — rules out mapping both verbs to the existing toggle.
- Clear the buffer and return focus to the tree after success; retain buffer and focus after parse, admission, or daemon failure — rules out losing a repairable command.
- Report the admitted pipeline id or daemon refusal message on the dock status row — rules out hidden results and rewritten daemon reasons.
- Leave selection unchanged after start — rules out pulling post-start focus-and-reveal into this change.
- Keep approval, rejection, resume, run pause/kill, log follow, history, and completion out of scope — rules out absorbing steering work.

## Acceptance criteria

- [ ] Submitting valid `start` input issues one detached admission through the same project, model, seed, pipeline-resolution, and `pipeline_start` path as `jarvis pipeline start`.
- [ ] Admission returns control without `pipeline_wait`; the dock later reports the admitted pipeline id and clears the successful command.
- [ ] A daemon refusal displays its message verbatim, keeps the buffer and command focus, and issues no second admission.
- [ ] Parse and pre-admission failures display named feedback and keep the buffer available for editing.
- [ ] `expand` and `collapse` idempotently set expansion for the selected pipeline or stage; unsupported selections report feedback without changing expansion.
- [ ] A `tui-entry.test.tsx` submission test fails against the inert baseline and proves the render session remains responsive while admission is pending.
- [ ] Added dispatch guards have `// @mutate` checkpoints on their real source conditions; no production inversion hooks are added.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — document dock grammar, submission outcomes, detached start semantics, and CLI fallbacks for unavailable verbs.
- `v2/docs/v1-behaviors.md` — record TUI pipeline admission and local expansion commands.
- `v2/spec/tui-overhaul-brief.md` — mark the command-dock behavior shipped while leaving steering open.

## Prerequisites

- A reusable detached pipeline-start admission API performs project, model, seed, pipeline resolution, and one `pipeline_start` request without waiting.
- `jarvis pipeline start` preserves attached and detached output and exit behavior around the shared admission API.
- A pure parser returns typed `start`, `expand`, and `collapse` commands plus named parse and recognized-unavailable errors.
- Recognized unavailable verbs name their existing CLI equivalents without runtime planning labels.
- A pure monitor-state projection produces exactly four dock rows with command buffer, cursor, focus, result/error, daemon status, and contextual hints.
- Split and stacked monitor layouts reserve exactly four dock rows for empty and long input.
- The injected input hook drives focus and cursor editing through monitor controls while suppressing tree bindings during command focus.
- `Enter` while focused submits the current buffer once; `Esc` restores tree focus without clearing the buffer.
