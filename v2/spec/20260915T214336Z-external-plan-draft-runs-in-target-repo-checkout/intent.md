---
name: external-plan-draft-runs-in-target-repo-checkout
---

# External plan draft invokes the draft agent in a materialized target-repo checkout

## Problem

`buildPlanWorkflowSteps` derives `git = specsHomeResolution.specsHome === "repo"` (`v2/src/execution/publication-workflow-steps.ts:630`), so `specs: external` (the default) drafts with `git: false`. Under that flag the worktree is not materialized as a repo, yet `promptPlaceholders.WORKDIR` points at `managedWorktreePath(...)` = `~/.jarvis/worktrees/<project>/plan/<branch>` (`publication-workflow-steps.ts:643,653`), a path never created for `git: false`; the agent actually runs in the external stage dir (`getExternalWorktreePath` = `localPath`). The draft prompt still instructs the agent to read the target repo (`prompts/plan/draft.md:13,37`; `v2/docs/v1-behaviors.md:240`), and the prerequisite gate must read committed code at the base — but under `specs: external` there is no repo at cwd, so a careful agent correctly blocks (evidence: TESTENG-144-01 plan draft blocked reporting the worktree/repo is absent).

## Decisions

- External plan draft requests a read-only target-repo checkout at the resolved base as the write step's invocation cwd, regardless of the `specs` publication home; the `specs` knob decides where the drafted tree persists, not whether the draft agent can read the code.
- The `WORKDIR` placeholder equals the directory the write step invokes the agent in, and that directory exists on disk; rules out advertising an unmaterialized `~/.jarvis/worktrees/...` path while the agent runs in the stage dir.
- The draft agent reads the target repo as its cwd, so every configured vendor reads it natively with no argv read-dir grant; opencode reads it via `--dir` (it exposes no `--add-dir`), claude/codex via cwd. Read root == cwd here, so the per-vendor divergent-read-root grant does not arise and stays scoped to external implement.
- The prerequisite gate reads committed code/tests/docs at the base for external specs, so a real `## Prerequisites` entry can block or pass on evidence; rules out only empty-prerequisite intents being draftable under `specs: external`.
- The drafted spec tree still persists to the external plan home (`consumeFrom: "source"`), unchanged; the read-context checkout is the agent's cwd, distinct from where the tree lands. Defaults preserve `specs: repo` drafting (already materializes a repo worktree at `WORKDIR`) exactly.

## Acceptance criteria

- [ ] A test drives `specs: external` plan draft and asserts the write step's invocation cwd exists and is a readable checkout of the target repo at the resolved base; it fails against the current `git: false` scratch-dir path that contains only the seeded intent.
- [ ] A test asserts the `WORKDIR` placeholder for an external-specs plan step equals the directory the write step invokes the agent in and that the directory exists on disk; it fails against the current `managedWorktreePath` placeholder, never created for `git: false`.
- [ ] A test asserts that under an opencode binding, external plan draft invokes `opencode run` with `--dir` set to the materialized target-repo checkout and emits no argv read-dir flag; it fails against a design leaving cwd as the repo-less stage dir or asserting a nonexistent opencode `--add-dir`.
- [ ] A test proves a non-empty `## Prerequisites` intent under `specs: external` appends a `## Blocker` when the named behavior is absent from committed code and drafts a spec tree when it is present; it fails against the current no-repo path where the gate cannot read the repo.
- [ ] A test asserts the drafted spec tree still persists to the external plan home unchanged; it fails if the read-context change diverts persistence away from the external stage.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record that external-specs plan draft materializes a target-repo read context delivered as the agent cwd, read natively by opencode via `--dir` (no argv read-dir grant; opencode exposes none).
- `v2/docs/workflow-runner.md` — external plan-draft read-context worktree and `WORKDIR` semantics.
- `v2/docs/agent-model-config.md` — how plan draft delivers repo read context as the agent cwd, and the per-vendor read-dir surfaces (claude/codex `--add-dir`; opencode `permission.external_directory` config) used only when the read root diverges from cwd.

## Prerequisites

- The git-less external-worktree stage can materialize a read-only target-repo checkout at the stage path, read as the agent cwd.
