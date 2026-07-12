# 00 - Resolve write-step placeholders from the prompt id's declared requirements

## Problem

`executeDefaultWrite` in `v2/src/execution/write.ts` builds `{SPEC_PATH, STEP_RULES, PRINCIPLES}`
only when `promptId === "write.execute"`, and passes `args.promptPlaceholders ?? {}` for every
other id. The `implement` preset pins `promptId: "patch.prompt.body"` and supplies no
placeholders, so the run dies at prompt rendering — `Required placeholder \`<SPEC_PATH>\` has no
value` — before any agent is spawned. `patch.prompt.body` declares seven required placeholders
(`SPEC_PATH`, `SIBLINGS_BLOCK`, `REPO_GUIDANCE`, `ACTIVE_SUBSPEC_PATH`, `ACTIVE_SUBSPEC_BODY`,
`PATCH_RULES`, `TIMEOUT_CHECKPOINT_CONTEXT`); none are supplied.

## Decisions

- Resolve placeholders by name against the registry's declared placeholders for the prompt id;
  drop the `promptId === DEFAULT_PROMPT_ID` branch — rules out a second hardcoded branch for
  `patch.prompt.body`, which moves the same trap one id right.
- Caller-supplied `promptPlaceholders` win over step-derived values — the shrink step's
  `ALLOWLIST`/`BRANCH_DIFF`/`RUN_SCOPED_DIFF` are git-derived in `workflow-runner.ts` and cannot
  be re-derived inside `write.ts`.
- `ACTIVE_SUBSPEC_PATH`/`ACTIVE_SUBSPEC_BODY` derive from the step's `expectedArtifactPath`
  (linked implement routing already rewrites it to the active link) — rules out re-resolving the
  index inside `write.ts`, duplicating routing.
- `REPO_GUIDANCE` reads `AGENTS.md`/`CLAUDE.md` from the worktree root, same source as v1's
  `readRepoGuidance`.
- `SIBLINGS_BLOCK` and `TIMEOUT_CHECKPOINT_CONTEXT` resolve to the empty string. Deferred to
  first consumer: v2 has no sibling-project config and no mid-run timeout checkpoint — pin when a
  caller needs them.
- A required placeholder with no resolver and no caller value fails the step at prompt build,
  naming the prompt id and the missing names — rules out rendering with `{}` and reaching the
  agent with a broken prompt. Reuse `executePlanDraftWrite`'s `PromptRenderingError` handling
  (`model_config` invocation failure), not a thrown exception that escapes the write loop.
- Prompt assembly (global fragments) is unchanged; only placeholder resolution moves.

## Task checklist

- [ ] Replace the `promptId` equality branch in `executeDefaultWrite` with per-name resolution
      driven by `loadPromptRegistry().getById(promptId).metadata.placeholders`.
- [ ] Overlay `args.promptPlaceholders` on the step-derived values.
- [ ] Fail the step as a `model_config` invocation failure when a declared required placeholder
      is unresolved.
- [ ] Add a regression test that drives the `implement` step through prompt rendering to agent
      invocation over the invocation seam.
- [ ] Update `v2/docs/write-behavior.md` and `v2/docs/workflow-runner.md`.

## Acceptance criteria

- [ ] A write step with `promptId: "patch.prompt.body"` and no caller placeholders renders its
      prompt and reaches agent invocation; the invoked prompt carries the spec path, the active
      subspec body, and the repo guidance read from the worktree root.
- [ ] `v2/src/execution/write.ts` contains no equality check against a specific prompt id for
      placeholder assembly; a prompt id with unresolved required placeholders fails the step as a
      `model_config` invocation failure naming the prompt id and the missing placeholder names,
      rather than spawning an agent.
- [ ] The shrink step (`patch.prompt.shrink`) still renders from the `promptPlaceholders`
      `workflow-runner.ts` supplies: `workflow-runner.test.ts` shrink tests stay green.
- [ ] `write.test.ts` plan-draft and intent-split write paths stay green (unchanged by the
      refactor).
- [ ] The regression test exercises the run through prompt rendering to agent invocation, not
      step construction alone.

## Documentation updates

- [ ] `v2/docs/write-behavior.md` — write-step prompt placeholders are resolved per prompt id
      from the registry's declared requirements, with the resolver source for each name and the
      caller-override rule.
- [ ] `v2/docs/workflow-runner.md` — the `implement` preset's prompt contract
      (`patch.prompt.body`, placeholders resolved from the step).
- [ ] `v2/docs/v1-behaviors.md` — record that v2's implement prompt sources `REPO_GUIDANCE` the
      same way v1 does, and leaves `SIBLINGS_BLOCK`/`TIMEOUT_CHECKPOINT_CONTEXT` empty.
