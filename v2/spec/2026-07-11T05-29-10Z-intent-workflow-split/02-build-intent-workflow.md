# Build the intent workflow

Build the unregistered intent workflow from explicit seed input and resolved project configuration.

## Decisions

- Accept exactly one of `--seed <path>` and `--seed-text <text>`, plus optional relative `--target-dir`; rule out positional, missing, dual, absolute, or traversal inputs.
- Resolve a file seed canonically and require it to remain inside the registered project after symlink resolution; rule out lexical and symlink escape.
- Derive the slug from the file basename or inline text with the repository slug utility, rejecting empty normalization and reserved `index` or `head`; rule out fallback slugs and artifact/ref pseudo-names.
- Treat an existing `intent/<slug>` branch, worktree, active workflow, or distinct concurrent seed mapping to the slug as a named collision unless it is the same resumable invocation; rule out suffixing, destructive reuse, or accidental workflow attachment.
- Resolve `targetDir` as run override, project `plan.targetDir`, global `modes.plan.targetDir`, then `spec`; rule out implementation-dependent fallback.
- Effective git publication follows project `plan.commit`, global `modes.plan.commit`, then `true`, but effective project `git: false` disables it; rule out assuming every project publishes.
- Git-enabled runs use `intent/<slug>` in `~/.jarvis/worktrees`, with base ref and PR base both the GitHub default branch resolved by the existing base resolver; rule out current `HEAD`, configured plan defaults, or differing PR bases.
- Existing local/remote branch or worktree state is reused only for the same recorded invocation; remote divergence fails with recovery guidance and no reset, force-push, or publication — rule out destructive repair.
- Git-disabled or non-git registered projects run without branch/worktree/commit/push/PR and land under `~/.jarvis/specs/<project-safe-id>/ready-intents/`; `--target-dir` still validates but does not relocate external output — rule out repo writes or unsupported non-git projects.
- Git-enabled durable output is `<targetDir>/ready-intents/`; rule out a separate intent destination setting.
- Author exactly one `write` step with `role: "plan"`, `promptId: "intent.prompt.split"`, the shared prompt, and `.jarvis-intent-stage/`; rule out review/refine steps or direct durable writes.

## Task checklist

- Parse and validate seed/target inputs, slug identity, project/config mode, base, destination, and collision state.
- Build the fixed intent step and completion metadata without registering the preset.
- Add builder tests for both seed forms, configuration modes, paths, collisions, base selection, and step shape.

## Acceptance criteria

- [ ] File and inline seeds build the same one-step split behavior; invalid inputs, canonical file escape, empty/reserved slug, or identity collision fail before daemon contact with recovery guidance where applicable.
- [ ] Target resolution is run override, project config, global config, then `spec`.
- [ ] Git-enabled construction uses `intent/<slug>`, a Jarvis-owned worktree, and one resolved remote-default base for both worktree and PR.
- [ ] Existing state resumes only the same invocation; concurrent, unrelated, or divergent state fails without deletion, reset, force-push, or suffixing.
- [ ] Git-disabled and non-git projects use Jarvis-owned external `ready-intents/` storage and request no git or GitHub operation.
- [ ] Both seed forms build exactly one plan-role write step using `intent.prompt.split`, the shared prompt, `.jarvis-intent-stage/`, and the intent pre-publication contract.
- [ ] Builder errors are returned before daemon start.

## Documentation updates

- `v2/docs/workflow-runner.md` — document builder inputs, precedence, identity, base, step, destination, and git/no-git contracts.
