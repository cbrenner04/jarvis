# Execution-loop production code drops invert-for-test hooks

Execution-loop and TUI modules thread `invert*ForTest` through `WriteLoopInput`, workflow-runner
deps, repair-fence helpers, and exported setters so guard-inversion ACs pass without mutating real
guards. Strip hooks and rewrite tests to `Mutation checkpoint:` comment-checkpoint source mutations
per `v2/docs/test-writing.md`.

## Prerequisites

- **Write-step rules** (`write-step-rules-forbid-production-invert-hooks` merged):
  comment-checkpoint guard-inversion contract in `shared/prompts/step-rules.ts` and
  `v2/docs/test-writing.md`.
- **Daemon** (`daemon-drop-production-invert-hooks` merged): daemon production modules carry no
  forbidden invert hooks.
- **CLI** (`cli-drop-production-invert-hooks` merged): CLI production modules carry no forbidden
  invert hooks; `workflow.test.ts` already checkpoints the external-worktree lock-release guard.
- **Ordering:** this spec lands before `guard-production-test-flags`; residual `invert*` shapes in
  execution-loop/TUI production would fail that static guard.

## Decisions

- Guard-inversion `(Manual)` mutation ACs: one representative pin per subspec (`00` names two —
  sidecar fence and `resolveIterationSettlementKind` — because the latter blocks the structural hook
  sweep). Remaining checkpoints use `Mutation checkpoint:` comments plus stays-green ACs citing the
  pinning test.
- `intent-output.ts`: verify-only under the hook sweep — comment checkpoints only, no production
  hooks to remove.

- [ ] [00 - Write loop drops invert-for-test hooks](./00-write-loop-drop-production-invert-hooks.md)
- [ ] [01 - Workflow runner drops invert-for-test hooks](./01-workflow-runner-drop-production-invert-hooks.md)
- [ ] [02 - Terminal publication drops invert-for-test hooks](./02-terminal-publication-drop-production-invert-hooks.md)
- [ ] [03 - Project pipeline resolution drops invert-for-test hooks](./03-project-pipeline-resolution-drop-production-invert-hooks.md)
- [ ] [04 - External worktree drops invert-for-test hooks](./04-external-worktree-drop-production-invert-hooks.md)
- [ ] [05 - TUI monitor terminal window drops invert-for-test hooks](./05-tui-monitor-terminal-window-drop-production-invert-hooks.md)
