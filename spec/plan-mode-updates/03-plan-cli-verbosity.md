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
- Preserve these details in the existing logging infrastructure. Prefer structured log-server/session-log events if plan mode already has access to them; otherwise add the smallest plan-mode logging hook needed to retain the details without printing them to the terminal.
- Do not make the quieter output depend on a new user-facing flag.
- Keep user-relevant progress lines, including:
  - `plan mode: interview commit pushed`
  - `plan mode: draft phase completed`
  - `plan mode: draft commit pushed`
  - the PR URL
  - `plan mode: draft PR #<n> opened`
  - review pass start and commit messages
  - blocker and failure messages
- Preserve setup diagnostics on failure only when they are needed for recovery. For example, a failed worktree creation may still print the failed path, but a successful run should not print all setup details by default.
- Resume output should stay concise as well, but this subspec is primarily about the initial-run setup diagnostics called out in the intent.

## Tasks

- [ ] Audit plan-mode terminal output in `src/commands/plan.ts` and `src/commands/plan-args.ts`; classify each line as default terminal output, debug/log output, or error output.
- [ ] Stop printing the setup diagnostics listed in this subspec to default stderr on successful initial plan runs.
- [ ] Preserve the omitted diagnostics in the log server, session log, or equivalent existing debug logging path.
- [ ] Add tests that assert quiet default output for a successful initial plan run.
- [ ] Ensure failure diagnostics still include enough information to recover.

## Acceptance criteria

- [ ] Default successful plan output no longer prints inline intent, target project root, temporary plan name, worktree path, spec name, or rename details.
- [ ] The omitted setup details are still recorded in the log server, session log, or equivalent debug logging path.
- [ ] Phase-progress, PR, review, blocker, quota, and failure messages remain visible in the CLI.
- [ ] Tests cover the quieter default output.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree so examples show the quieter default output.
