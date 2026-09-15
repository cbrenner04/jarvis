---
name: external-plan-draft-read-context-worktree
---

# External-specs plan draft reads a materialized target-repo checkout

## Problem

`buildPlanWorkflowSteps` sets `git = specsHomeResolution.specsHome === "repo"` (`v2/src/execution/publication-workflow-steps.ts:630`), so `specs: "external"` (the default) drafts with `git: false`. That strands the draft agent three ways: `withExternalWorktree` only `mkdirSync`s the external stage dir and never checks out the repo (`external-worktree.ts:93-100`); the `WORKDIR` placeholder points at `managedWorktreePath(...)` which is never created for `git: false` while the agent actually runs in the external stage dir (`publication-workflow-steps.ts:643,653`); and `prompts/plan/draft.md:13,37` plus the prerequisite gate require repo reads the external stage cannot satisfy. TESTENG-144-01 (external-specs, opencode binding) blocked reporting the worktree "doesn't exist at the expected path".

## Decisions

- External plan draft exposes a read-only checkout of the target repo at the resolved base to the draft agent regardless of the `specs` publication home; `specs` decides where the drafted tree persists, not whether the agent can read the code. Genuinely git-less runs used by tests keep skipping materialization.
- The `WORKDIR` placeholder names the directory the write step actually invokes the agent in, and that directory exists on disk.
- The plan-draft write step passes the target-repo read root to the adapter as a read grant, so every configured vendor (including opencode) reads the repo; the prerequisite gate reads committed code/tests/docs at the base so a real `## Prerequisites` entry can block or pass on evidence.
- `specs: repo` behavior is unchanged: it already materializes a repo worktree at `WORKDIR`.

## Prerequisites

- opencode adapter accepts a target-repo read-dir grant

## Acceptance criteria

- [ ] A test drives `specs: external` plan draft and asserts the draft agent's invocation cwd exists and is a readable checkout of the target repo at the resolved base; it fails against the current `git: false` scratch-dir path that contains only `intent.md`.
- [ ] A test asserts the `WORKDIR` placeholder for an external-specs plan step equals the directory the write step invokes the agent in and that the directory exists on disk; it fails against the current `managedWorktreePath` placeholder never created for `git: false`.
- [ ] A test asserts the plan-draft adapter invocation for `specs: external` receives a target-repo read grant equivalent to the claude/codex read-dir grant; it fails while the plan-draft step passes no read root.
- [ ] A test proves a non-empty `## Prerequisites` intent under `specs: external` appends a `## Blocker` when the named behavior is absent from committed code and drafts a spec tree when it is present; it fails against the current no-repo path where the gate cannot read the repo.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — external plan-draft read-context worktree and `WORKDIR` semantics.
- `v2/docs/v1-behaviors.md` — external-specs plan draft materializes a target-repo read context.
- `v2/docs/agent-model-config.md` — plan draft grants a per-vendor read-dir grant to the target-repo read root.
