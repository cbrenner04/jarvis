# Add the `implement` workflow preset and demote `write-write`

`resolveWorkflowPreset` (`v2/src/execution/workflow-runner.ts`) currently
supports only `write-write` (2 steps). Add `implement`, a 1-step preset whose
`role` and `promptId` are fixed by the preset rather than supplied by the
caller, and stop presenting `write-write` as the operator-facing example.

## Decisions

- `implement`'s pinned `promptId` is `patch.prompt.body` (`prompts/patch/instructions.md`,
  registered in `prompts/registry.txt`) — the only registered write-loop-compatible
  prompt body for patch/implement work, rules out inventing a new prompt artifact.
- `resolveWorkflowPreset("implement", steps)` injects `role: "implement"` and
  `promptId: "patch.prompt.body"` onto the single step unconditionally
  (overriding any `role`/`promptId` the caller passes), matching the "preset-owned,
  not caller-supplied" decision in `intent.md` — rules out a shape where the
  caller must still supply `role`/`promptId` and the preset only validates them.
- Callers still supply `promptPlaceholders` matching `patch.prompt.body`'s
  placeholder contract (`SPEC_PATH`, `SIBLINGS_BLOCK`, `REPO_GUIDANCE`,
  `ACTIVE_SUBSPEC_PATH`, `ACTIVE_SUBSPEC_BODY`, `PATCH_RULES`) plus `stepRules`,
  `expectedArtifactPath`, `agents`, and `agentModelConfig` — same per-step
  content contract `write-write` steps use today.
- `write-write` keeps its existing 2-step validation entry for composability
  tests; it is removed from `workflow-runner.md`'s and `state-store.md`'s
  illustrative prose in favor of `implement` (or a neutral 2-step example),
  since those docs are what an operator reads to pick a preset.

## Acceptance criteria

- [ ] `resolveWorkflowPreset("implement", steps)` with 1 step returns a
      `WorkflowStep[]` whose single step has `behavior: "write"`,
      `role: "implement"`, and `promptId: "patch.prompt.body"`, regardless of
      any `role`/`promptId` passed in `steps[0]`.
- [ ] `resolveWorkflowPreset("implement", steps)` throws when `steps.length !== 1`,
      naming the required and received counts (same message shape as the
      existing `write-write` wrong-count error).
- [ ] `resolveWorkflowPreset("unknown-preset", steps)` still throws and names
      the invalid preset (existing behavior unchanged).
- [ ] `resolveWorkflowPreset("write-write", steps)` is unchanged (still 2
      steps, still throws on wrong count) — `workflow-runner.test.ts` keeps a
      `write-write` composability test, but it is the only place the codebase
      still exercises the name.
- [ ] `v2/docs/workflow-runner.md`'s preset-surface section and prose examples
      demote `write-write` and use `implement` (or a name-neutral 2-step
      example) as the illustrative preset an operator would reach for.
- [ ] `v2/docs/state-store.md`'s per-step attempt-history example no longer
      names `write-write`.

## Documentation updates

- `v2/docs/workflow-runner.md`: add `implement` to the "Current preset surface"
  list with its fixed `role`/`promptId`; update prose examples to stop citing
  `write-write` as the reference composition.
- `v2/docs/state-store.md`: update the per-step attempt-history example to not
  name `write-write`.
