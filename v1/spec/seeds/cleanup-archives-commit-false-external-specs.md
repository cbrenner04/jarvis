---
name: cleanup-archives-commit-false-external-specs
---

# cleanup archives commit:false external specs (not just in-repo spec/)

## Problem

`jarvis1 cleanup` removes merged worktrees correctly, but for a `commit:false`
project it **does not archive completed specs**. For every merged spec it prints:

```
removed <branch>
no spec directory moved for <branch>: missing <repo>/spec/<branch>
```

It looks for the spec under the **in-repo** `<repo>/spec/<name>`, but under
`commit:false` the specs live in the **external** home
`~/.jarvis/specs/<proj>/<name>/` — the same place `intent`/`plan` write them. So
worktrees get cleaned while the external spec dirs are left behind, and the
operator manually `mv`s them into `~/.jarvis/specs/<proj>/completed/` and prunes
the consumed `ready-intents/`.

Same root cause as the in-repo-location assumption behind #529: cleanup ignores
the external `commit:false` home. Intake #566.

## Direction

When `commit === false`, archive completed specs from the external home
(`~/.jarvis/specs/<proj>/<name>/` → `~/.jarvis/specs/<proj>/completed/`) and
prune the corresponding consumed `ready-intents/<name>.md`, instead of looking
under in-repo `spec/`. Resolve the home the same way `intent`/`plan` do so the
two stay in lockstep. Verify against `groceries-client` (`plan.commit = false`).

## Documentation updates

- `v1/docs/config.md` (or the cleanup reference) — note the external-home
  archival path under `commit:false`.
- Operator runbook end-of-session cleanup — drop the manual `mv`/prune note once
  cleanup handles it.
