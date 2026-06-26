---
name: cleanup-archives-commitfalse-external-specs
---

# cleanup does not archive commit:false specs (looks in-repo `spec/` only)

## Problem

`jarvis1 cleanup` retires merged worktrees but, for a `commit:false` project,
**fails to archive the completed specs**. Per merged spec it prints:

```
removed <branch>
no spec directory moved for <branch>: missing <repo>/spec/<branch>
```

It resolves the spec under the **in-repo** `<repo>/spec/<name>`, but under
`commit:false` the specs live in the **external** home
`~/.jarvis/specs/<proj>/<name>/` (where `intent`/`plan` write them). So worktrees
get cleaned while the external spec dirs are stranded, forcing the operator to
hand-`mv` them into `~/.jarvis/specs/<proj>/completed/` and prune the consumed
`ready-intents/`.

Same root cause as #529: cleanup assumes the in-repo spec location and ignores
the external `commit:false` home. Intake #566.

## Direction

When `commit === false`, archive completed specs from the external home
(`~/.jarvis/specs/<proj>/<name>/` → `~/.jarvis/specs/<proj>/completed/`) and prune
the corresponding consumed `ready-intents/<name>.md`, instead of looking under
in-repo `spec/`. Mirror whatever path-resolution `intent`/`plan` already use for
the external home so the two stay consistent.

## Out of scope

- Changing in-repo (`commit:true`) cleanup behavior — that path works today.

## References

- Cleanup spec-archive path resolution in `v1/src/` (cleanup command).
- Intake issue #566; sibling #529 (intent external-seeds-dir).
