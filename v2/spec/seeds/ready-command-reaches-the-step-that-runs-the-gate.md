---
name: ready-command-reaches-the-step-that-runs-the-gate
---

# The project's ready command never reaches the step that runs the gate

## Problem

`stampWorkflowStepsWithMachineConfig` applies `readyCommand`/`fixCommand` to `behavior: "write"` steps only; `review` and `review-debate` steps get `roleTimeoutMs`/`idleOutputMs` and nothing else. The finalization tail runs the ready gate on a review row, so `readyCommand` is `undefined` there and `resolveReadyGateCommand` falls back to `bun run ready`. Any project whose gate is not a bun script does all of its work, opens its PR, and then fails at the tail. The settlement is stamped `fix_config`, pointing the operator at config that is already correct.

Reported as [#3598](https://github.com/cbrenner04/jarvis/issues/3598) against project `sudoku` (Swift, no `package.json`, `readyCommand: "scripts/ready.sh"`, `terminalAction: "ready"`).

## Evidence

- `v2/src/commands/workflow-step-config-stamp.ts` — the non-write branch returns the step with only review bounds added.
- `v2/src/execution/workflow-runner.ts:1539-1540` — the snapshot carries `fixCommand`/`readyCommand` under the `behavior === "write"` branch only, so a review step cannot rehydrate one either.
- `v2/src/execution/ready-finalize.ts:48-49` — `resolveReadyGateCommand` defaults to `bun run ready` on `undefined`.
- Run `473417b6-6b82-458b-9fb7-616d8d99f565` settled `ready_gate_command_missing` with `iterationsConsumed: 0`, `readyGateCommand: "bun run ready"`, `prNumber: 3` — a gate-only tail on a non-write row, after every subspec write pass succeeded.
- Reporter's correlation: exposed only under `terminalAction: "ready"`; a sibling project on `terminalAction: "merge"` never runs the tail gate and has 63 clean notifications.

## Decisions

- Resolve the project's gate commands for **every** step that can run the ready gate, from one resolution point keyed on the step's project; rules out per-behavior stamping that must be extended again for the next step kind, and rules out the review step borrowing its write sibling's stamped value (a review step can settle a gate with no write sibling in scope).
- The snapshot persists the resolved commands for review steps too, so a resumed gate-only tail runs the same command as the original dispatch; rules out resume silently reverting to the default.
- `ready_gate_command_missing` names the command it ran **and** whether that command came from `projects.<key>.readyCommand` or the built-in default; `nextAction` stays `fix_config` only when the command was configured. A default-sourced miss is a harness resolution failure, not operator config; rules out sending the operator to already-correct config.
- Machine-wide behavior for projects with no `readyCommand` is unchanged, pinned; rules out changing the default while fixing propagation.
- Scope is the propagation defect only. The broader per-project override block stays with [[per-project-config-overrides-seam]]; rules out absorbing that P2 seam here.

## Acceptance criteria

- [ ] A stamping test proves a `review` and a `review-debate` step for a project with a configured `readyCommand` carry that command, and that a project with none carries no override; it fails against the current write-only branch.
- [ ] A workflow-runner regression proves a review-step finalization gate for a project configured with a non-bun `readyCommand` invokes that command, not `bun run ready`; it fails against the pre-fix `undefined` resolution.
- [ ] A snapshot round-trip test proves a review step's resolved `readyCommand` survives persistence and rehydration, so a resumed gate-only tail runs the configured command.
- [ ] A settlement test proves `ready_gate_command_missing` distinguishes a configured command from the built-in default in its evidence, and reports `fix_config` only for the configured case; it fails against the pre-fix single message.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — `readyCommand`/`fixCommand` apply to every gate-running step, not write steps only.
- `v2/docs/write-behavior.md` — gate command resolution point and the configured-versus-default settlement distinction.
- `v2/docs/operator-runbook.md` — `ready_gate_command_missing` evidence now names the command source; `fix_config` applies only to a configured command.
- `v2/docs/v1-behaviors.md` — record the changed v2 gate-command resolution.
