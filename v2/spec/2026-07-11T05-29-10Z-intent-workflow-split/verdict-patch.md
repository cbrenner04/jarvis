- Git-disabled/non-git runs must land validated output durably, remove staging, and report the actual durable paths without any git/PR operation.

- Pre-publication failures must persist a failed `pre-publication` workflow state with rerun guidance, while retaining staging and preventing publication. An in-memory failure after a persisted completed run is insufficient.

- Intent identity must be enforced in production before daemon start and recorded for the invocation. Existing branch, worktree, active workflow, or same-slug seed state may resume only when owned by that invocation; otherwise fail safely.

- Reused branch/worktree state must also reject divergent remotes and unowned reuse, with recovery guidance and no destructive reset, rebase, overwrite, or force-push.

- Shared intent repair and validation must require a first body level-one H1. Deeper headings cannot satisfy or bypass that contract.

- `--seed` must reject absolute paths, while retaining canonical containment checks for relative paths and symlink escapes.

- Transactional landing must restore the destination exactly to its prior state after any failure, including removing a newly created `ready-intents/` directory when none existed before.

These outcomes are required by the completed spec’s safety, retry, validation, git-disabled, and atomic-landing acceptance contracts.
