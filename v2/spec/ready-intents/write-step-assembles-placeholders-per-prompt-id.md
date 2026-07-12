---
name: write-step-assembles-placeholders-per-prompt-id
---

# Write step assembles placeholders per prompt id

The write step must supply every placeholder its prompt requires, resolved from the
step, for any prompt id — not just the default `write.execute`.

## Problem

`v2/src/execution/write.ts` special-cases `promptId === DEFAULT_PROMPT_ID` to build
`{SPEC_PATH, STEP_RULES, PRINCIPLES}` and falls back to `args.promptPlaceholders ?? {}`
for every other id. The `implement` preset
(`v2/src/execution/implement-workflow-steps.ts`) sets `promptId: "patch.prompt.body"`
and supplies no placeholders, so `patch.prompt.body`'s required `<SPEC_PATH>` has no
value and the run fails at prompt rendering, ~29ms after `iteration_started`, before
any agent is spawned. Observed 2026-07-12 on `main` at `4525d3a9`:

```json
{"kind":"run_execution_failed","message":"Prompt rendering error: Required placeholder `<SPEC_PATH>` has no value"}
```

The shrink step already does this correctly (`shrinkPromptPlaceholders` in
`v2/src/execution/workflow-runner.ts` derives `SPEC_PATH`, `SPEC_TREE`, `ALLOWLIST`,
`BRANCH_DIFF` from the step). The write step has no equivalent.

## Behavior

- Placeholder assembly is driven by the prompt id's declared requirements, resolved
  from the step — not by an equality check against one id.
- Remove the `promptId === DEFAULT_PROMPT_ID` branch. A second hardcoded branch for
  `patch.prompt.body` moves the same trap one id to the right; a new prompt id must
  not silently get `{}`.
- A `jarvis run workflow implement` run reaches agent invocation.

## Regression coverage

Construction-level assertions are insufficient — this bug and its sibling worktree
ENOENT both passed step-construction tests and failed on first real launch. Coverage
must exercise the run through prompt rendering to agent invocation.

## Out of scope

- `implement`'s first-launch worktree ENOENT (separate seed).
- The write-loop terminal-token contract (separate seed).

## Documentation updates

- `v2/docs/write-behavior.md` — how write-step prompt placeholders are assembled per prompt id.
- `v2/docs/workflow-runner.md` — the `implement` preset's prompt contract.

## Prerequisites

- The `implement` workflow preset constructs a write step with `promptId: "patch.prompt.body"`.
- The prompt registry declares required placeholders per prompt id.
