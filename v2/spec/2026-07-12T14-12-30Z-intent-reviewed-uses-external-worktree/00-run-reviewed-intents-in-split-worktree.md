# Run reviewed intents in the split worktree

Make reviewed-intent review and deferred completion operate on the workspace materialized by its split step.

## Decisions

- Resolve review `cwd`, verdict, staging, boundary enforcement, and deferred landing from the split worktree contract — rules out deriving them from the operator checkout and drifting from configured Jarvis roots or git-disabled local paths.
- Keep staging and deferred landing after review in that resolved workspace — rules out moving reviewed output into the operator checkout before publication.
- Surface deferred landing failure as `invocation_failure` with its cause — rules out returning a failure kind without the landing diagnostic.

## Tasks

- Derive reviewed-intent review paths from the split write step's resolved external-worktree configuration for git-enabled and git-disabled projects.
- Run critic, actuator, verdict handling, boundary restoration, and post-review landing in that derived workspace.
- Preserve reviewed-intent completion/publication after successful landing and retain the landing error on failure.
- Add focused builder and runner coverage, then align the operator workflow docs.

## Acceptance criteria

- [ ] `buildReviewedIntentWorkflowSteps` derives the review `cwd`, verdict path, staging path, and deferred landing worktree from the split step's configured Jarvis-root worktree for git-enabled projects.
- [ ] Git-disabled reviewed-intent runs derive those paths from the split step's local intent-work path and perform no Git or GitHub publication.
- [ ] A reviewed-intent run leaves unrelated dirty files in the operator checkout unchanged while critic, actuator, boundary enforcement, and verdict handling run in the split workspace.
- [ ] A successfully reviewed intent lands and publishes its durable output from the split workspace to the configured git-enabled destination.
- [ ] Deferred reviewed-intent landing failure returns `invocation_failure` and exposes the landing failure cause for retry diagnostics.
- [ ] `v2/docs/first-workflow-walkthrough.md` and `v2/docs/workflow-runner.md` document reviewed-intent review cwd, staging, publication, and landing-failure behavior.

## Documentation updates

- Update `v2/docs/first-workflow-walkthrough.md`.
- Update `v2/docs/workflow-runner.md`.
