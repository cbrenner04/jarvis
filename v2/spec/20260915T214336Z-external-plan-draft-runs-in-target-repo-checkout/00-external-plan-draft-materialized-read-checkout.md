# External plan draft invokes the agent in a materialized target-repo read checkout

## Problem

`planSource` (`v2/src/execution/publication-workflow-steps.ts:614`) derives `git = specsHomeResolution.specsHome === "repo"`, so `specs: external` (the default) drafts with `git: false`. Under that flag the write step's invocation cwd is the external stage dir (`getExternalWorktreePath` = `localPath` = `externalPlanPath`), materialized by `withExternalWorktree` as an `mkdirSync`-only empty dir containing only the seeded intent — no target-repo content. Yet `promptPlaceholders.WORKDIR` is set to `managedWorktreePath(...)` (`publication-workflow-steps.ts:643,653`), a path never created for `git: false`. The draft prompt instructs the agent to read the target repo (`prompts/plan/draft.md`), and the prerequisite gate must read committed code at the base, but there is no repo at cwd, so a careful agent blocks.

`v2/src/execution/external-worktree.ts` already implements `materializeReadCheckout` (`external-worktree.ts:129`), gated behind `ExternalWorktreeInput.materializeReadCheckout` (`external-worktree.ts:32,101`): on the `git: false` + `localPath` branch it extracts a `.git`-less readable checkout of `projectRoot` at `baseRef` into `localPath` via `tar -x` before the callback. No production caller sets it; plan draft is its first consumer.

## Decisions

- External plan draft sets `materializeReadCheckout: true` on the `git: false` write-step worktree and a real `baseRef` (resolved via `resolveBaseBranch`/`getBaseBranch`), so the stage dir becomes a readable target-repo checkout at the base; rules out leaving `baseRef: "none"` (archive of `"none"` fails) or the empty `mkdirSync`-only stage the agent cannot read.
- `WORKDIR` for the external plan step equals the stage dir (`externalPlanPath`), the directory the write step invokes the agent in and that now exists on disk; rules out the current `managedWorktreePath` placeholder never created for `git: false`.
- The draft agent reads the target repo as its cwd, so no argv read-dir grant is added; opencode reads it via its existing `--dir cwd` argv (`shared/invocation/agents.ts:1284`), claude/codex via cwd. Read root == cwd, so `resolveImplementAdditionalReadDirs` stays scoped to external implement and emits no flag; rules out asserting a nonexistent opencode `--add-dir`.
- The prerequisite gate reads committed code/tests/docs at the base from the materialized checkout, so a non-empty `## Prerequisites` entry can block or pass on evidence; rules out only empty-prerequisite intents being draftable under `specs: external`.
- Intent seeding precedes checkout materialization, and `materializeReadCheckout` cleans `localPath` before extracting so `tar -x` never merges checkout content over the seeded `intent.md` or prior-run debris; rules out a merge-over that leaves a stale root `intent.md` or debris shadowing the base checkout.
- The read checkout is re-extracted per run with no reuse and no `node_modules`; draft only reads, so re-extraction cost is acceptable and rules out speculative caching or symlinking `node_modules` for a read-only pass.
- The drafted spec tree still persists to the external plan home unchanged (`consumeFrom: "source"`, `durableSpecPath = externalPlanPath`); the read-context checkout is the agent's cwd, distinct from where the tree lands. Defaults preserve `specs: repo` drafting exactly (already materializes a git worktree at `WORKDIR`).

## Task checklist

- In `planSource`, for the `git: false` branch: resolve a real `baseRef` (via `deps.resolveBaseBranch ?? getBaseBranch`), set `WORKDIR` placeholder to the stage dir (`externalPlanPath`), and add `materializeReadCheckout: true` to the worktree input.
- Confirm `specs: repo` (`git: true`) drafting is byte-identical: `WORKDIR` stays `managedWorktreePath`, no `materializeReadCheckout`, persistence unchanged.
- Update docs in the durable homes below.

## Acceptance criteria

- [ ] A test drives `specs: external` plan draft and asserts the write step's invocation cwd is a readable checkout of the target repo at the resolved base (contains committed source the prerequisite gate could read, not just the seeded intent); it fails against the current `git: false` scratch-dir path that contains only the seeded intent.
- [ ] A test asserts the `WORKDIR` placeholder for an external-specs plan step equals the stage dir the write step invokes the agent in and that the directory exists on disk; it fails against the current `managedWorktreePath` placeholder never created for `git: false`.
- [ ] A test asserts that under an opencode binding, the `--dir` target of external plan draft's `opencode run` argv now holds materialized target-repo content (delta is the cwd contents, argv unchanged); the opencode `--dir cwd`/no-argv-read-dir shape stays green (`agents.ts` opencode argv preserved).
- [ ] A test asserts the drafted spec tree still persists to the external plan home unchanged; it fails if the read-context change diverts persistence away from the external stage.
- [ ] `specs: repo` plan-draft step shape (WORKDIR, worktree, persistence) stays green (behavior unchanged for the git branch).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.
- [ ] `bun run test:shared` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record that external-specs plan draft materializes a target-repo read context delivered as the agent cwd, read natively by opencode via `--dir` (no argv read-dir grant; opencode exposes none).
- `v2/docs/workflow-runner.md` — external plan-draft read-context stage and `WORKDIR` = agent cwd semantics.
- `v2/docs/agent-model-config.md` — plan draft delivers repo read context as the agent cwd; per-vendor read-dir surfaces (claude/codex `--add-dir`; opencode `permission.external_directory`) apply only when the read root diverges from cwd.
