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
- Callers still pass placeholder `role`/`promptId` values on `steps[0]` (silently
  discarded) rather than a new call signature that omits those fields for pinned
  presets — keeps one `resolveWorkflowPreset(name, steps: WorkflowStep[])` shape
  across all presets instead of a per-preset input type, per the intent's "not a
  new ad hoc shape" scope constraint.
- Callers still supply `promptPlaceholders` matching `patch.prompt.body`'s
  placeholder contract (`SPEC_PATH`, `SIBLINGS_BLOCK`, `REPO_GUIDANCE`,
  `ACTIVE_SUBSPEC_PATH`, `ACTIVE_SUBSPEC_BODY`, `PATCH_RULES`) plus `stepRules`,
  `expectedArtifactPath`, `agents`, and `agentModelConfig` — same per-step
  content contract `write-write` steps use today.
- `write-write` keeps its existing 2-step validation entry and its end-to-end
  composability test (`workflow-runner.test.ts`: "runs the write-write preset
  end to end with per-step resolution, ordered advancement, fallback, and
  separate durable history") — 1-step `implement` cannot structurally cover
  that 2-step scenario. It is dropped only from `workflow-runner.md`'s and
  `state-store.md`'s operator-facing prose that merely names an example preset,
  since those docs are what an operator reads to pick a preset. Prose describing
  cross-step semantics (per-step resolution order, step-two-after-step-one
  sequencing) is inherently a 2-step case and keeps an unnamed/generic 2-step
  example instead of naming `write-write` or `implement`.

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
      steps, still throws on wrong count) — `workflow-runner.test.ts` keeps
      "runs the write-write preset end to end with per-step resolution,
      ordered advancement, fallback, and separate durable history" unchanged;
      only narrower resolve/validation-only `write-write` tests may consolidate.
- [ ] `v2/docs/workflow-runner.md`'s "Current preset surface" list adds
      `implement` alongside `write-write`.
- [ ] `v2/docs/workflow-runner.md` prose that merely names an example preset
      (not describing cross-step behavior) cites `implement` instead of
      `write-write`.
- [ ] `v2/docs/workflow-runner.md` prose describing cross-step semantics (e.g.
      per-step resolution order, "step two begins only after step one
      completes") keeps an unnamed/generic 2-step example — not `write-write`,
      not `implement` — since a 1-step preset cannot illustrate cross-step
      behavior.
- [ ] `v2/docs/state-store.md`'s per-step attempt-history example (inherently
      2-step: "step one and step two keep separate attempt histories")
      generalizes to an unnamed 2-step case rather than naming `write-write`
      or forcing in `implement`.

## Documentation updates

- `v2/docs/workflow-runner.md`: add `implement` to the "Current preset surface"
  list with its fixed `role`/`promptId`; retitle single-preset-example prose to
  `implement`; leave cross-step-semantics prose on a generic/unnamed 2-step
  example.
- `v2/docs/state-store.md`: reword the per-step attempt-history example to a
  generic/unnamed 2-step case instead of naming `write-write`.
