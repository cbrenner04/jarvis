# 03 - Plan CLI Verbosity

## Problem

Plan mode prints setup details that are useful for debugging but too noisy for normal CLI output. In the example from the intent, the first six lines are sanity-check details:

```text
plan mode: inline intent="..."
plan mode: target project=...
plan mode: temporary plan name=...
plan mode: worktree created at ...
plan mode: spec name=...
plan mode: renamed worktree and branch to ...
```

Those should be available to the log server or debug logs, but should not print by default in the terminal. Later phase-progress lines are still useful and should remain.

## Decisions

- Default terminal output should omit setup diagnostics before `plan mode: interview commit pushed`.
- Preserve these details in the log server or existing structured logging path if one is available in plan mode.
- If there is no existing log-server event for these details, add one in the smallest compatible way rather than dropping the information entirely.
- Keep user-relevant progress lines, including:
  - `plan mode: interview commit pushed`
  - `plan mode: draft phase completed`
  - `plan mode: draft commit pushed`
  - the PR URL
  - `plan mode: draft PR #<n> opened`
  - review pass start and commit messages
  - blocker and failure messages
- Do not add a new verbosity flag unless the existing CLI already has an appropriate debug or verbose option.

## Tasks

- [ ] Audit `src/commands/plan.ts` stderr output and classify each line as default terminal output, log-server/debug output, or error output.
- [ ] Stop printing the setup diagnostics listed in this subspec to default stderr.
- [ ] Preserve the omitted diagnostics in log-server/debug output.
- [ ] Add tests that assert quiet default output for a successful initial plan run.
- [ ] Ensure failure diagnostics still include enough information to recover.

## Acceptance criteria

- [ ] Default successful plan output no longer prints inline intent, target project root, temporary plan name, worktree path, spec name, or rename details.
- [ ] The omitted setup details are still recorded in the log server or equivalent debug logging path.
- [ ] Phase-progress, PR, review, blocker, quota, and failure messages remain visible in the CLI.
- [ ] Tests cover the quieter default output.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree so examples show the quieter default output.
