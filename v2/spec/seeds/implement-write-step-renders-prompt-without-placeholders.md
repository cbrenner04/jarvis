# implement's write step renders `patch.prompt.body` with no placeholders

The `implement` preset cannot invoke an agent. Its write step builds a prompt whose
required placeholders are never supplied, so the run dies at prompt rendering,
before any agent is spawned.

## Problem

Observed 2026-07-12 on `main` at `4525d3a9`, after working around the separate
first-launch worktree bug (`implement-linked-routing-reads-index-before-worktree-exists`)
by pre-creating the worktree:

```sh
jarvis run workflow implement --base main \
  --spec v2/spec/2026-07-12T21-57-58Z-daemon-process-log-read/index.md
```

```json
{"kind":"boundary_committed","outcomeKind":"invocation_failure","runStatus":"failed"}
{"kind":"run_execution_failed","message":"Prompt rendering error: Required placeholder `<SPEC_PATH>` has no value"}
```

The run fails 29ms after `iteration_started`. No agent is invoked.

Cause is a hardcoded special-case in `v2/src/execution/write.ts:274-281`:

```ts
const placeholders =
  promptId === DEFAULT_PROMPT_ID              // "write.execute"
    ? { SPEC_PATH: specPath, STEP_RULES: args.stepRules, PRINCIPLES: … }
    : (args.promptPlaceholders ?? {});        // ← implement lands here, with {}
```

`implement-workflow-steps.ts:187` sets `promptId: "patch.prompt.body"` and supplies
**no** `promptPlaceholders`. `patch.prompt.body` requires `<SPEC_PATH>`, so
rendering throws.

Only the default `write.execute` prompt gets placeholders built for it. That is why
the ad-hoc write loop (`jarvis run start`) works and the workflow `implement` preset
has never run.

The *shrink* step in the same preset does this correctly —
`workflow-runner.ts:1175-1185` (`shrinkPromptPlaceholders`) assembles `SPEC_PATH`,
`SPEC_TREE`, `ALLOWLIST`, `BRANCH_DIFF` from the step. The write step has no
equivalent.

## Scope

- The implement write step must supply every placeholder `patch.prompt.body`
  requires, derived from the step (as the shrink step already does).
- Kill the `promptId === DEFAULT_PROMPT_ID` special-case in `write.ts`. Placeholder
  assembly belongs with the prompt, not behind an equality check on one id — the
  current shape means any new prompt id silently gets `{}`.
- Regression coverage: an `implement` run must reach agent invocation. A test that
  asserts step *construction* is not enough — both this and the sibling ENOENT bug
  passed construction-level tests and failed on first real launch.

## Decisions

- Fix placeholder assembly generically (per-prompt-id requirement, resolved from the
  step), not by adding `patch.prompt.body` as a second hardcoded branch — a second
  branch just moves the same trap one prompt id to the right.
- A prompt-rendering error must name the prompt id alongside the missing
  placeholder. `Required placeholder <SPEC_PATH> has no value` gives the operator no
  way to tell which prompt failed.

## Out of scope

- `implement`'s first-launch worktree ENOENT — separate seed.
- The write-loop terminal-token contract — separate seed
  (`invalid-token-discards-completed-work`).

## Documentation updates

- `v2/docs/write-behavior.md` — record how write-step prompt placeholders are
  assembled per prompt id.
- `v2/docs/workflow-runner.md` — the implement preset's prompt contract.
