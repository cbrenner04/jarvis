# Phase 1 write step (operator runbook)

Phase 1 is one `jarvis write` invocation over one external worktree checkout.
It runs one effective invocation order and exits after the first non-quota
result.

## Run

From the target repo root:

```bash
jarvis write --task "Complete the highest-priority unchecked acceptance criterion."
```

## Side effects

- Materializes or reuses `~/.jarvis/worktrees/<project>/<branch>/`.
- Acquires `<worktree>/.jarvis.lock` for the full write step.
- Runs the write prompt in that worktree checkout.
- Releases `.jarvis.lock` before process exit.

## Verification

- Confirm stdout is one terminal line:
  - `done <worktree-path>`
  - `no-work <worktree-path>`
  - `progress <worktree-path>`
  - `blocked <reason>`
- For `done` and `no-work`, deterministic output-contract checks run before a
  success outcome is emitted.
- If every configured invocation is quota-classified, the command exits non-zero
  and surfaces `error all agents quota-exhausted`.

## Outcome meaning

- `done`: terminal success; contract check passed.
- `no-work`: terminal success; contract check passed with no remaining required work.
- `progress`: non-complete, non-error stop; no retry loop in Phase 1.
- `blocked`: immediate blocked stop from agent-reported blocker.
- `error`: hard non-success (non-quota failure, malformed output token, or
  contract miss after `done`/`no-work`).
