# Build implement-workflow steps from cwd + run args

Add a pure builder that turns "operator is standing in a project checkout,
wants to run `implement` on a branch/spec" into the `steps[]` payload the
daemon `start` RPC already accepts for workflow-shaped runs.

## Decisions

- Project resolution matches cwd against the registered-project rules in
  `v1/src/config.ts` (`findProjectMatchForPath`), not a new v2 lookup —
  reuses the same registry `~/.jarvis/config.json` already used by v1.
  Rules out inventing a parallel v2 project-registry format.
- No ad-hoc (unregistered-git-checkout) fallback: cwd must resolve to a
  project registered via `jarvis init`/`jarvis config`. Rules out silently
  running against an unregistered directory, which the intent's registry
  wording doesn't ask for.
- Builder output is one `implement`-preset write step (`resolveWorkflowPreset("implement", [...])`)
  run through `loadWorkflowSteps` so `agents`/`agentModelConfig` come from
  machine config, not a CLI flag. Rules out an operator-supplied `--agents`
  override, which the intent's "thinner than `jarvis write`" decision forbids.
- Per-run required inputs are branch, base ref, spec path, and expected
  artifact path — these stay genuinely per-run (spec-specific) and are not
  preset-owned, unlike role/promptId/agents.
- Step rules text reuses the same default `jarvis write` uses today (no new
  wording invented for this entry point).

## Task Checklist

- [ ] Add a builder function (e.g. `buildImplementWorkflowSteps`) taking
      `{ cwd, branchName, baseRef, specPath, artifactPath }` plus injectable
      deps for project resolution and `loadWorkflowSteps`.
- [ ] Resolve the project from `cwd` via `findProjectMatchForPath`; no match
      is a caller-facing error result, not a thrown exception.
- [ ] Assemble the single `implement` step's `worktree` fields from the
      resolved project (`projectRoot`, `projectName`) plus the run args
      (`branchName`, `baseRef`), and its `specPath`/`expectedArtifactPath`
      from the run args.
- [ ] Run the assembled step through `resolveWorkflowPreset("implement", [...])`
      then `loadWorkflowSteps(...)` and return the resulting `AnyWorkflowStep[]`.
- [ ] Surface `loadWorkflowSteps` config-load/role-validation failures as a
      caller-facing error result (same shape as the project-resolution miss),
      not an uncaught throw.

## Acceptance criteria

- [ ] Given a cwd inside a project registered in `~/.jarvis/config.json`,
      the builder returns a one-step workflow whose step has `role: "implement"`
      and `promptId: "patch.prompt.body"` (preset-pinned) and `agents`/`agentModelConfig`
      populated from machine config.
- [ ] Given a cwd outside any registered project, the builder returns an
      error result naming the unresolved cwd rather than throwing.
- [ ] Given a cwd inside a registered project but a machine config that fails
      role/agent validation, the builder returns an error result carrying that
      failure rather than throwing.

## Documentation updates

- Document the builder and its resolution/error-result contract in
  `v2/docs/workflow-runner.md` (near the existing preset/`loadWorkflowSteps`
  sections), since this is the first consumer wiring cwd-based project
  resolution into workflow-step construction.
