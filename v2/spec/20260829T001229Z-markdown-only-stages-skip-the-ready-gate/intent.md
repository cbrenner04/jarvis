---
name: markdown-only-stages-skip-the-ready-gate
---

# Markdown-only stages skip the ready gate

## Prerequisites

- The v2 ready gate runs a project's configured `readyCommand` and falls back to `bun run ready`, reporting the resolved command on the gate error.
- A gate failure whose output shows the command itself is missing settles immediately under a named outcome, with no autofix and no repair iteration.

## Surface

Execution loop: ready finalization admission for markdown-only workflow stages.

## Problem

- Intent split and plan draft produce only `.md` under the run's markdown output roots, yet their stages still run the project ready gate — so a markdown-only stage red-gates (or, on a project with no `ready` script, fails outright) on a suite that has nothing of the stage's output to verify.

## Behavior

- A workflow stage whose prompt is markdown-only skips the ready gate and finalizes on its existing markdown provenance fence.

## Decisions

- Key the skip off the existing markdown-only workflow prompt resolution (`resolveMarkdownOnlyWorkflowPromptId`) rather than inspecting staged paths; rules out a diff-shape heuristic that would also skip a code stage that happened to change only docs.
- Skip the gate rather than settling a named unconfigured outcome for markdown-only stages; rules out a second non-red terminal kind for a stage that has nothing to verify, and rules out making the skip depend on whether a `ready` script resolves.
- Keep the markdown provenance fence and completion publication unchanged; rules out treating "skips the gate" as "skips finalization", which would drop the fence that stopped the scaffolding commit.

## Required verification

- A finalization test drives a markdown-only stage on a project with no resolvable ready command and asserts the gate never spawns and the stage succeeds; it fails against the pre-fix unconditional gate.
- A test asserts a code-bearing stage in the same workflow still runs the gate.
- A test asserts the markdown provenance fence still rejects a non-`.md` staged path on a skipped-gate stage.

## Documentation updates

- `v2/docs/install-and-config.md` — markdown-only stages skip the ready gate.
- `v2/docs/write-behavior.md` — ready finalization admission for markdown-only prompts.
- `v2/docs/workflow-runner.md` — intent-split and plan-draft stages finalize without the gate.
- `v2/docs/v1-behaviors.md` — markdown-only stages no longer run the project ready gate.
