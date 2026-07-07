# Build implement-workflow steps from cwd + run args

Add a pure builder that turns "operator is standing in a project checkout,
wants to run `implement` on a branch/spec" into the `steps[]` payload the
daemon `start` RPC already accepts for workflow-shaped runs.

## Decisions

- Project resolution matches cwd against `findProjectMatchForPath` in
  `v1/src/config.ts` — reuses the same registry `~/.jarvis/config.json`
  already used by v1. Rules out inventing a parallel v2 project-registry
  format. Deliberately **not** `v1/src/resolve-project.ts`'s `resolveProject`:
  that function's full resolution chain includes an ad-hoc/unregistered-git-checkout
  fallback, which would contradict this subspec's own "no ad-hoc fallback"
  decision below. `findProjectMatchForPath` is the narrower, registry-only
  primitive that matches cwd against `config.projects` with no fallback.
- No ad-hoc (unregistered-git-checkout) fallback: cwd must resolve to a
  project registered via `jarvis init`/`jarvis config`. Rules out silently
  running against an unregistered directory, which the intent's registry
  wording doesn't ask for.
- Pipeline order is preset-fields-first, loader-last — the two calls don't
  compose the other way round: `resolveWorkflowPreset`'s parameter type
  requires `agents`/`agentModelConfig` already present, while
  `loadWorkflowSteps`'s parameter type (`WorkflowSourceStep`) requires
  `behavior`/`role`/`promptId` already present and is what *supplies*
  `agents`/`agentModelConfig`. So the builder assembles a `WorkflowSourceStep`
  directly (setting `behavior`, `stepId`, `role`, `promptId`, `stepRules`
  itself, matching `implement`'s preset-pinned values), then calls
  `loadWorkflowSteps([sourceStep], ...)` to produce the final
  `WriteWorkflowStep[]`, then passes that through
  `resolveWorkflowPreset("implement", ...)` as a step-count/pinned-field
  re-affirmation (its parameter type structurally accepts the already-built
  `WriteWorkflowStep[]`). Rules out the reverse call order, which does not
  typecheck.
- Builder does not accept an `--agents` override; `agents`/`agentModelConfig`
  come from `loadWorkflowSteps`'s machine-config load. Rules out an
  operator-supplied agents override, which the intent's "thinner than
  `jarvis write`" decision forbids.
- Per-run required inputs are branch, base ref, spec path, and expected
  artifact path — these stay genuinely per-run (spec-specific) and are not
  preset-owned, unlike role/promptId/agents.
- Step rules text reuses the same default `jarvis write` uses today
  (`DEFAULT_WRITE_STEP_RULES` in `v2/src/execution/write-loop-input.ts`) —
  export it from that module for reuse rather than duplicating the string.
- This is the first `v2/src/**` file to import from `v1/src/**`
  (`findProjectMatchForPath`). No existing boundary rule prohibits it, but it
  is a new precedent, not an established pattern — flagged so later spec
  review doesn't need to re-derive whether v2→v1 imports are already normal.

## Task Checklist

- [ ] Add a builder function (e.g. `buildImplementWorkflowSteps`) taking
      `{ cwd, branchName, baseRef, specPath, artifactPath }` plus injectable
      deps for project resolution and `loadWorkflowSteps`.
- [ ] Resolve the project from `cwd` via `findProjectMatchForPath`; no match
      is a caller-facing error result, not a thrown exception. Map the
      resulting `ProjectMatch`'s `root` field to `worktree.projectRoot` and
      its `key` field to `worktree.projectName` (`ProjectMatch` has no
      `projectRoot`/`projectName` fields of its own).
- [ ] Assemble a `WorkflowSourceStep` (`v2/src/execution/workflow-loader.ts`)
      directly: `behavior: "write"`, `stepId: "implement"`,
      `role: "implement"`, `promptId: "patch.prompt.body"` (the `implement`
      preset's pinned role/promptId, matching
      `WORKFLOW_PRESET_PINNED_FIELDS.implement` in
      `v2/src/execution/workflow-runner.ts`), `stepRules:
      DEFAULT_WRITE_STEP_RULES`, `worktree: { projectRoot, projectName,
      branchName, baseRef }` (mapped per above), `specPath`,
      `expectedArtifactPath: artifactPath`.
- [ ] Run the assembled `WorkflowSourceStep` through
      `loadWorkflowSteps([sourceStep], deps)` to fill in
      `agents`/`agentModelConfig` from machine config, producing
      `WriteWorkflowStep[]`.
- [ ] Pass that `WriteWorkflowStep[]` through
      `resolveWorkflowPreset("implement", ...)` and return the resulting
      `AnyWorkflowStep[]`.
- [ ] Surface `loadWorkflowSteps`'s thrown config-load/role-validation
      failures as a caller-facing error result (same shape as the
      project-resolution miss), not an uncaught throw.

## Acceptance criteria

- [x] Given a cwd inside a project registered in `~/.jarvis/config.json`,
      the builder returns a one-step workflow whose step has `role: "implement"`
      and `promptId: "patch.prompt.body"` (preset-pinned) and `agents`/`agentModelConfig`
      populated from machine config.
- [x] Given a cwd outside any registered project, the builder returns an
      error result naming the unresolved cwd rather than throwing.
- [x] Given a cwd inside a registered project but a machine config that fails
      role/agent validation, the builder returns an error result carrying that
      failure rather than throwing.

## Documentation updates

- Document the builder, its resolution/error-result contract, and the
  preset-fields-first/loader-last pipeline order in `v2/docs/workflow-runner.md`
  (near the existing preset/`loadWorkflowSteps` sections). Note there that this
  is the first `v2/src/**` module to import from `v1/src/**`
  (`findProjectMatchForPath`), as a precedent for future v2 specs reusing v1
  registry/config code, not yet an established convention.
