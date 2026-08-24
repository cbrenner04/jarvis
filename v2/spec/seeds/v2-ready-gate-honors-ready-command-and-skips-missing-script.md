---
name: v2-ready-gate-honors-ready-command-and-skips-missing-script
---

# v2 ready gate hardcodes `bun run ready`, ignores readyCommand, and dispatches a repair agent for a missing script

## Problem

v2's ready gate is hardcoded to `bun run ready` (`createDefaultRunReadyGate`, `v2/src/execution/ready-finalize.ts:895`, throwing `ReadyGateError("bun run ready", …)` at :910/:913). The per-project `projects.<key>.readyCommand` override is read only by v1 (`v1/src/ready-gate.ts`); `grep readyCommand v2/src` returns nothing, and `v2/docs/install-and-config.md` documents no v2 equivalent. So every v2 run on a non-JS project — or any project without a `package.json` `ready` script — fails its gate with `error: Script not found "ready"`, even a markdown-only intent stage that has nothing to verify.

Worse, the red gate dispatched ready-gate **repair**: the repair agent spent ~14 minutes scaffolding an entire Xcode project (`ChessPractice.xcodeproj/`, `Makefile`, `package.json`, `scripts/`, README edits) trying to make a `ready` script exist, then settled `blocked` → `ready_gate_failed`. The `markdownOnly: true` fence stopped the commit, but the tokens and wall time were spent and the worktree was left dirty. The stage `failureDetail` carried only `{ reason: "ready_gate_failed" }`; the useful stderr (`Script not found "ready"`) lived only in the `intent_finalization` log event.

Reported from `cbrenner04/chess-mvp-yolo` (iOS/SwiftUI, no `package.json`; `pipeline: { name: "fast", terminalAction: "merge" }`, no `readyCommand`), pipeline `b8b32325`, GitHub issue #2957. Related: #2954 (same session).

## Decisions

- `createDefaultRunReadyGate` resolves `projects.<key>.readyCommand` (and `fixCommand`) before falling back to `bun run ready`, and `v2/docs/install-and-config.md` documents the v2 override — rules out the hardcode that ignores per-project config v1 already honors.
- Never dispatch ready-gate repair when the gate failed because the command itself is missing (`Script not found`, `command not found`, ENOENT): that is a configuration error an agent cannot repair inside the allowset. Settle immediately with a named outcome and a message naming the missing command — rules out the 14-minute scaffold-the-project repair attempt.
- Skip the ready gate for markdown-only workflows (intent split, plan draft produce only `.md`), or settle a named `ready_gate_unconfigured` outcome rather than a red gate when no gate is configured and no `ready` script resolves — rules out gating a stage that has nothing for a project test suite to verify.
- Carry the gate's stderr excerpt on the stage `failureDetail.message`, not only in the `intent_finalization` log event — rules out the cause-less `{ reason: "ready_gate_failed" }` that hid the missing-command detail.
- Out of scope (note only): a non-required `jarvis init` `ready-gate` readiness row warning when neither `readyCommand` nor a `package.json` `ready` script resolves.

## Acceptance criteria

- [ ] The v2 ready gate resolves and runs `projects.<key>.readyCommand` when configured, falling back to `bun run ready` only when it is absent — pinned by a test with and without a configured `readyCommand`.
- [ ] A ready gate that fails because the command is missing (`Script not found`/`command not found`/ENOENT) settles immediately with a named outcome and a message naming the missing command, dispatching no repair agent — pinned by a test asserting no repair invocation on a missing-command failure.
- [ ] A markdown-only workflow stage (only `.md` staged) either skips the ready gate or settles `ready_gate_unconfigured` (named, non-red) instead of failing on a missing `ready` script — pinned by a test.
- [ ] A failed ready gate records its stderr excerpt on the stage `failureDetail.message` — pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — document the v2 `readyCommand`/`fixCommand` overrides and the default `bun run ready` fallback; note that a missing gate command settles named (no repair) and markdown-only stages skip the gate. Closes #2957.
