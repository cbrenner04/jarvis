---
name: missing-ready-gate-command-settles-without-repair
---

# A missing ready-gate command settles named, without repair

## Prerequisites

- The v2 ready gate runs a project's configured `readyCommand` and falls back to `bun run ready`, reporting the resolved command on the gate error.
- A stage failed by the ready gate carries a `failureDetail.message` naming the gate command and a bounded excerpt of its output.

## Surface

Execution loop: ready-gate failure classification and the repair loop.

## Problem

- A gate that fails because the command does not exist is treated as a repairable red gate: the run ran project autofix and a repair agent, which spent ~14 minutes scaffolding an Xcode project, `Makefile`, `package.json`, and `scripts/` to make a `ready` script exist before settling `blocked` → `ready_gate_failed` on a dirty worktree.

## Behavior

- A gate failure whose output shows the command itself is missing settles immediately under a named outcome whose message names the missing command, with no autofix and no repair iteration.

## Decisions

- Classify missing-command failures from the gate output and spawn error (`Script not found`, `command not found`, ENOENT) into a distinct `ReadyGateError` failure kind; rules out matching on exit code alone, which a genuinely red suite shares.
- Settle the run under a named non-repairable outcome kind mapped in `RUN_OPERATOR_ERROR_RECOVERY` with `nextAction: "fix_config"`; rules out `resume`, which cannot make a missing command exist, and rules out reusing `ready_gate_failed`, which advertises a repairable red gate.
- Gate the suppression ahead of both the autofix entry and the repair loop; rules out a fence-only stop that still burns an autofix spawn and a repair iteration before refusing the commit.

## Required verification

- A write-loop test drives a gate failure whose output names a missing command and asserts zero repair invocations, zero autofix invocations, and the named outcome kind; it fails against the pre-fix repair dispatch.
- A test asserts the settled message names the missing command.
- A test asserts an ordinary red gate (command present, suite failing) still enters bounded repair.

## Documentation updates

- `v2/docs/install-and-config.md` — a missing gate command settles named with no repair; fix the config, do not resume.
- `v2/docs/operator-runbook.md` — recovery for the named missing-command outcome.
- `v2/docs/write-behavior.md` — ready finalization skips autofix and repair for missing-command failures.
- `v2/docs/v1-behaviors.md` — missing gate command is no longer a repairable red gate.
