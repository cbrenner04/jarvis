---
name: commit-false-intent-validates-external-seeds-dir
---

# commit:false file-seed `intent` validates against the external seeds dir

## Problem

Under `plan.commit: false`, `jarvis1 intent --repo <proj> <seed-file>` rejects
every file-seed path with `intent: raw seed files must live under <targetDir>/seeds/`.
The validation always resolves the seeds dir to the in-repo
`project.root/<targetDir>/seeds`, but for `commit: false` the operator-authored
seed home lives externally at `~/.jarvis/specs/<projectSafeId>/seeds/`. So a seed
in the documented location can never satisfy the check and file-mode `intent` is
unusable for any `commit: false` project. Observed on `groceries-client`, intake
issue #529.

## Direction

- When `commit === false`, validate the file-seed path against the external spec
  home (`join(externalRoot, "seeds")` = `~/.jarvis/specs/<projectSafeId>/seeds/`),
  the same `externalRoot` the no-commit branch already computes — not the in-repo
  `project.root/<targetDir>/seeds`.
- Accept a seed under whichever seeds dir is active for the resolved commit mode.
- Keep the `commit: true` path unchanged (in-repo seeds dir is correct there).

## Out of scope

- The `commit: true` validation path.
- Run-stem naming behavior.

## References

- `v1/src/commands/intent.ts` (~L599 validation, ~L612 externalRoot).
- Intake issue #529.

## Prerequisites
