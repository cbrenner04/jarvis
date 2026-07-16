# 01 - Expose merged-workspace cleanup

Expose the retirement operation as `jarvis cleanup`, preserving v1's preview and confirmation vocabulary for the v2 worktree home.

## Decisions

- Scope cleanup to the registered project containing the operator's cwd; rules out a machine-wide sweep of unrelated projects.
- Support only `jarvis cleanup [--dry-run]`; rules out importing v1 archival, scoped-name, or `--abandon` behavior before their dedicated specs.
- `--dry-run` prints worktree and local-branch removals without prompting or mutating; rules out a preview whose candidate set differs from confirmed cleanup.
- Accept only `y` or `yes` at `Remove these worktrees? [y/N]`; rules out accidental retirement on empty or ambiguous input.

## Acceptance criteria

- [ ] `jarvis cleanup` resolves the project containing cwd, previews eligible worktree and local-branch removals, and prompts `Remove these worktrees? [y/N]` before execution.
- [ ] A non-affirmative response prints cancellation and changes nothing; `y` and `yes` execute the previewed retirement set.
- [ ] `jarvis cleanup --dry-run` prints the same eligible removals, performs no mutation, and does not prompt.
- [ ] Invalid flags or positional arguments and an unregistered cwd return concise usage errors; inspection or retirement failures return non-zero.
- [ ] `v2/src/cli.test.ts` regression coverage drives `jarvis cleanup`, `--dry-run`, cancellation, confirmation, invalid arguments, registered-project resolution, and exit codes; these command tests fail against the pre-fix code and pass after implementation.
- [ ] The command contract, safety workflow, and session-end invocation are documented in their durable homes without duplicating the contract.

## Documentation updates

- `v2/docs/write-behavior.md` — own the `jarvis cleanup [--dry-run]` CLI, output, and exit contract.
- `v2/docs/operator-runbook.md` — document merged-workspace cleanup and safety guards; replace the no-v2-cleanup/manual-removal stopgap only for merged workspaces.
- `v2/docs/first-workflow-walkthrough.md` — add the session-end cleanup invocation and link to the runbook for details.
