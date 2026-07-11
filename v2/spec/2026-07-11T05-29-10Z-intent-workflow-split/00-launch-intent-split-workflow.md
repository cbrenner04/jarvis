# Launch the intent split workflow

Add the registered v2 `intent` builder and CLI inputs that produce one staged split step from the current registered project.

## Decisions

- Register `intent` beside `implement`; rule out a separate command or natural-language routing.
- Accept exactly one of `--seed <path>` and `--seed-text <text>`, plus optional `--target-dir <relative-dir>`; rule out positional, missing, dual, absolute, or traversal inputs.
- Resolve file seeds from cwd and derive their slug from the filename; derive inline-seed slugs with the repository slug utility; rule out model-selected branch names — branch/worktree identity must exist before execution.
- Use branch `intent/<slug>` and the Jarvis-owned `~/.jarvis/worktrees` checkout for the cwd-resolved registered project; rule out running the write step in the operator checkout.
- Author exactly one `write` step with `role: "plan"`, `promptId: "intent.prompt.split"`, and a staging-directory artifact path; rule out review, refine, or direct durable writes.
- Read `--target-dir` as the per-run override above registered project and global plan target configuration; rule out a separate intent destination setting.

## Task checklist

- Add typed `intent` argument parsing and builder registration.
- Resolve the registered project, seed content/label, target directory, branch, worktree, plan-role binding, shared split prompt, and staged artifact contract before daemon contact.
- Add focused builder and CLI dispatch tests for both seed forms, override precedence, step shape, worktree identity, and pre-daemon errors.

## Acceptance criteria

- [ ] `jarvis run workflow intent --seed <path>` and `--seed-text <text>` dispatch the registered builder and send one daemon `start` request only after successful construction.
- [ ] Missing, dual, unreadable, absolute/traversing, or otherwise invalid seed/target inputs exit nonzero before daemon contact with terse operator guidance.
- [ ] Both seed forms build exactly one plan-role write step using `intent.prompt.split`, the shared split prompt, and a staging-directory expected artifact.
- [ ] The builder resolves the registered project from cwd, uses `intent/<slug>`, and places the workflow checkout under `~/.jarvis/worktrees`.
- [ ] `--target-dir` overrides configured plan target resolution for the later `<targetDir>/ready-intents/` destination.
- [ ] Existing `v2/src/cli.test.ts` implement-preset cases stay green (behavior unchanged while the registry grows).
- [ ] `v2/docs/workflow-runner.md` documents the `intent` preset, accepted builder inputs, fixed step contract, project/target resolution, branch, and worktree boundary.

## Documentation updates

- `v2/docs/workflow-runner.md` — add the registered preset and builder contract; cross-link the operator walkthrough.
