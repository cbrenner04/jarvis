---
name: plan-draft-stale-finalspecpath
---

# Intent

`jarvis plan` regressed for `modes.plan.commit: true` runs. Reproduction:

```
$ jarvis plan spec/wip-intents/draft-intention-doc.txt
plan: refine phase started
plan: refine: refined
plan: refine commit pushed
plan: draft phase error: ENOENT: no such file or directory, open
  '/Users/chris.brenner/Work/jarvis/.worktree/plan-tmp-fdfaad1a/spec/2026-05-19T18-23-57Z-jarvis-draft-intent-command/intent.md'
```

The refine phase succeeds, the temporary plan worktree is renamed via
`git worktree move` from `.worktree/plan-tmp-<id>/` to
`.worktree/plan-<plan-name>/`, but the draft phase then tries to read
`intent.md` from the old `plan-tmp-<id>` worktree path.

Root cause: in `src/commands/plan.ts`, `finalSpecPath` is computed for the
commit-true branch with `join(worktreePath, "spec", specDirBasename)` while
`worktreePath` still points at the temporary plan worktree. A few lines
later, `git worktree move` runs and `worktreePath` is reassigned to the
final `.worktree/plan-<plan-name>/` path, but `finalSpecPath` is not
refreshed. The draft phase then reads `intent.md` from the now-deleted
temporary path and crashes.

Scope: small surgical fix in `src/commands/plan.ts`. No behavior change for
`commit: false` (where `finalSpecPath` is the Jarvis-owned storage root and
is unaffected by the worktree move).
