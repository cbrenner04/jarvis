---
name: commit-false-file-seed-validation-wrong-seeds-dir
---

# commit:false file-seed `intent` rejects every seed: validates against the wrong seeds dir

## Problem

Under `commit: false`, `jarvis1 intent --repo <proj> <seed-file>` rejects every
file-seed path with `intent: raw seed files must live under spec/seeds/`. The
validation (`v1/src/commands/intent.ts` ~L599) always resolves the seeds dir to
the **in-repo** `project.root/<targetDir>/seeds`:

```ts
const seedDir = join(project.root, targetDir, "seeds");
if (inv.mode === "file" && !isPathInside(seedDir, inv.seedPath)) { /* reject */ }
```

But under `commit: false` the spec home — and thus operator-authored seeds — lives
**externally** at `~/.jarvis/specs/<projectSafeId>/seeds/` (the same `externalRoot`
the non-commit branch computes ~L612). So a seed authored in the documented
location can never satisfy the check, and file-mode `intent` is unusable for any
`commit: false` project.

Workarounds are bad: dropping the seed into the target repo's `spec/seeds/` is
unsafe (the no-commit `run` path snapshots the checkout via `git status` /
`snapshotCheckoutPaths`, so an untracked in-repo seed dir risks polluting that
baseline); passing the seed as inline text loses the frontmatter `name:` (the run
name falls back to the first 6 words of the body).

Observed on `groceries-client` (`plan.commit = false`), intake issue #529.

## Direction

- When `commit === false`, validate the file-seed path against the **external**
  spec home (`join(externalRoot, "seeds")` =
  `~/.jarvis/specs/<projectSafeId>/seeds/`) instead of (or in addition to) the
  in-repo `project.root/<targetDir>/seeds`. Equivalently: accept a seed under
  whichever seeds dir is active for the resolved commit mode.
- Bonus: honor the seed's frontmatter `name:` for the run stem so an inline
  submission keeps a stable name.

## Out of scope

- The `commit: true` path (in-repo seeds dir is correct there).

## References

- `v1/src/commands/intent.ts` (~L599 validation, ~L612 externalRoot).
- Intake issue #529.
