# Write behavior

`jarvis write` runs one `write` behavior turn.

## Command

```
jarvis write \
  --project-root <repo-root> \
  --project <project-name> \
  --branch <branch-name> \
  --base <git-ref> \
  --spec <path-in-worktree> \
  --artifact <path-in-worktree> \
  --agent-outcomes <csv> \
  [--emit-artifact true]
```

- Worktree path: `~/.jarvis/worktrees/<project>/<branch>/`.
- Locking uses v1-compatible `.jarvis.lock` semantics.
- One invocation pass only; no automatic retry loop for `progress`.

## Outcomes

- `done` / `no-work`: runner checks `--artifact` existence.
- `progress`: surfaced as non-success; no contract check.
- `blocked`: surfaced as blocked; no contract check.
- Contract miss: surfaced as `contract_miss` (distinct from `blocked`).

## Verification

1. Run with terminal outcome and artifact emission:

```bash
jarvis write \
  --project-root "$PWD" \
  --project demo \
  --branch write-run \
  --base HEAD \
  --spec README.md \
  --artifact proof.txt \
  --agent-outcomes done \
  --emit-artifact true
```

2. Confirm result JSON reports `"kind": "complete"`.
3. Confirm artifact exists in worktree:
   `~/.jarvis/worktrees/demo/write-run/proof.txt`.
