# 03 - Plan CLI Verbosity

## Problem

Plan mode prints setup details that are useful for debugging but too noisy for normal CLI output. In the example from the intent, these setup lines are sanity-check details:

```text
plan mode: inline intent="..."
plan mode: target project=...
plan mode: temporary plan name=...
plan mode: worktree created at ...
plan mode: spec name=...
plan mode: renamed worktree and branch to ...
```

Those should be available to the log server, session log, or another existing debug path, but should not print by default in the terminal. Later phase-progress lines are still useful and should remain.

## Decisions

- Default terminal output should omit the setup diagnostics listed above for successful initial plan runs.
- Preserve these details in existing non-terminal logging. Prefer the mode-entry/session logging path already available to `jarvis plan`; do not invent a second log destination if the current log client can record the details.
- Do not make the quieter output depend on a new user-facing flag.
- Keep user-relevant progress lines, including:
  - `plan mode: interview commit pushed`
  - `plan mode: draft phase completed`
  - `plan mode: draft commit pushed`
  - the PR URL
  - `plan mode: draft PR #<n> opened`
  - review pass start and commit messages
  - blocker and failure messages
- Keep the initial invocation classification out of default output for inline and file modes. Interactive mode may keep a short `plan mode: interactive session started` line if it is needed to orient a TTY user.
- Preserve setup diagnostics on failure only when they are needed for recovery. For example, a failed worktree creation may still print the failed path, but a successful run should not print all setup details by default.
- Resume output should stay concise as well, but this subspec is primarily about the initial-run setup diagnostics called out in the intent.
- Do not suppress agent stderr, quota fallback messages, model-configuration messages, validation errors, or blocker summaries.

## Tasks

- [ ] Audit plan-mode terminal output in `src/commands/plan.ts` and `src/commands/plan-args.ts`; classify each line as default terminal output, debug/log output, or error output.
- [ ] Stop printing the setup diagnostics listed in this subspec to default stderr on successful initial plan runs.
- [ ] Preserve the omitted diagnostics in the log server, session log, or equivalent existing debug logging path.
- [ ] Add tests that assert quiet default output for a successful initial file or inline plan run.
- [ ] Add tests or fixture assertions that the omitted diagnostics are still recorded through the chosen non-terminal logging path.
- [ ] Ensure failure diagnostics still include enough information to recover.

## Acceptance criteria

- [ ] Default successful plan output no longer prints inline intent, target project root, temporary plan name, worktree path, spec name, or rename details.
- [ ] The omitted setup details are still recorded in the log server, session log, or equivalent debug logging path.
- [ ] Phase-progress, PR, review, blocker, quota, and failure messages remain visible in the CLI.
- [ ] File-mode output also avoids printing the full intent path as a normal successful setup diagnostic unless needed for an error.
- [ ] Interactive-mode output remains usable in a terminal while still avoiding the noisy setup lines after naming succeeds.
- [ ] Tests cover the quieter default output.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree so examples show the quieter default output.
