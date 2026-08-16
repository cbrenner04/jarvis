---
name: tui-typed-run-steering-clears-command-input
---

# Dock submit leaves stale input on some verbs and can fail silently

## Problem

Two inconsistencies in `jarvis tui`'s command-input submit path (`v2/src/tui/tui-entry.tsx`, `submitCommand`) make the dock feel like nothing happened after Enter:

1. **Run-steering verbs never clear.** Submitting `kill`, `pause`, or `resume-run` dispatches the RPC (via `runSteeringAction`) and returns without clearing the buffer or restoring tree focus. Every other verb — `start`, `approve`, `reject`, `resume`, `expand`, `collapse` — clears `commandBuffer`/`commandCursor` and restores `focus: "tree"` on success. Observed 2026-08-16: the operator only knew a typed `kill` took effect because the tree changed, not because the input reset.
2. **`start` can fail silently.** The `start` arm wraps `admitDetachedPipelineStart` in `try/finally` with **no `catch`** (unlike the `approve`/`reject`/`resume` arm, which catches and reports `steeringFeedbackFromError`). A normal admission *failure* comes back as a result and is reported via `formatAdmissionFailureFeedback`, but a *thrown* admission (daemon transport error, socket drop) is swallowed: no `lastCommandResult`, buffer left intact, unhandled rejection — indistinguishable from "the command did nothing." Observed 2026-08-16 while an operator was unsure whether a pipeline start had submitted.

## Decisions

- On a successful typed `kill`/`pause`/`resume-run` dispatch, clear `commandBuffer` and `commandCursor`, restore `focus: "tree"`, and bump the command-editor generation — matching the `start`/`approve` success path. Run steering is fire-and-forget (dispatch, not settlement), so "success" means the RPC was dispatched after the selection guards passed, consistent with the `k` key.
- Give the `start` arm a `catch` that reports the thrown error on `lastCommandResult` (same shape as the `approve`/`reject`/`resume` catch), so a transport-level admission throw surfaces feedback and the buffer stays repairable rather than the command vanishing silently.
- A pre-dispatch selection failure (`no_selection`, `not_live_run`, `stale_non_expandable`) still retains the buffer, cursor, and command focus and reports its code — unchanged. Rules out clearing on the error paths.

## Acceptance criteria

- [ ] A typed `kill` on a live steerable run clears the buffer and cursor and restores tree focus after dispatch, pinned by a test that fails against the pre-fix (non-clearing) branch.
- [ ] Typed `pause` and `resume-run` clear identically, pinned by tests.
- [ ] A typed run-steering verb that fails its selection guard retains buffer, cursor, and command focus and reports the code, pinned by a test.
- [ ] A typed `start` whose admission RPC throws reports feedback on `lastCommandResult` and retains the buffer, pinned by a test that fails against the pre-fix (no-catch) arm.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — note (in the dock-commands outcomes text) that typed `kill`/`pause`/`resume-run` now clear the input like the other verbs, and that a `start` transport throw now surfaces feedback instead of vanishing.
