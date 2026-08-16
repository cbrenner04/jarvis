---
name: tui-typed-run-steering-clears-command-input
---

# Typed kill/pause/resume-run leave the command in the input after dispatch

## Problem

In `jarvis tui`, submitting a `kill`, `pause`, or `resume-run` verb from the command input dispatches the RPC but does not clear the buffer or restore tree focus, so the typed command lingers in the dock after Enter. Observed 2026-08-16: the operator only knew the command had taken effect because the change appeared in the tree, not because the input reset. Every other dock verb — `start`, `approve`, `reject`, `resume`, `expand`, `collapse` — clears `commandBuffer`/`commandCursor` and restores `focus: "tree"` on success; the run-steering branch (`v2/src/tui/tui-entry.tsx`, the `kill`/`pause`/`resume-run` arm of `submitCommand`, which calls `runSteeringAction` and returns) is the lone exception.

## Decisions

- On a successful typed `kill`/`pause`/`resume-run` dispatch, clear `commandBuffer` and `commandCursor`, restore `focus: "tree"`, and bump the command-editor generation — matching the `start`/`approve` success path. Run steering is fire-and-forget (dispatch, not settlement), so "success" here means the RPC was dispatched after the selection guards passed, consistent with the `k` key.
- A pre-dispatch selection failure (`no_selection`, `not_live_run`, `stale_non_expandable`) still retains the buffer, cursor, and command focus and reports its code on `lastCommandResult` — unchanged, so a repairable input survives. Rules out clearing on the error paths.

## Acceptance criteria

- [ ] A typed `kill` on a live steerable run clears the buffer and cursor and restores tree focus after dispatch, pinned by a test that fails against the pre-fix (non-clearing) branch.
- [ ] Typed `pause` and `resume-run` clear identically, pinned by tests.
- [ ] A typed run-steering verb that fails its selection guard retains buffer, cursor, and command focus and reports the code, pinned by a test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — note (in the dock-commands outcomes text) that typed `kill`/`pause`/`resume-run` now clear the input and restore tree focus on dispatch like the other verbs.
