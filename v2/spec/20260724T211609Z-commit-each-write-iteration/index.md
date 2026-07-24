# Commit each write-loop iteration

repo: cbrenner04/jarvis

Per-iteration agent edits on git-backed write loops are committed on `progress` (not only at terminal completion), so same-branch kill/reconcile retains prior iteration SHAs and PR history shows each step; implement re-run reset behavior is unchanged.

- [ ] [00 - Git-commit each changed write-loop iteration](./00-per-iteration-git-commit.md)
- [ ] [01 - Preserve terminal completion boundary and multi-commit attribution](./01-terminal-boundary-and-attribution.md)
