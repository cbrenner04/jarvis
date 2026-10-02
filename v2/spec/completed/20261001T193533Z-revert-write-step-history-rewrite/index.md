# Revert write-step agent lane history rewrites

Write-step agents can rebase or reset the lane; ready-repair fencing only sees uncommitted paths, so a rewritten clean tree publishes and `resolveLeaseTip` rejects the lane's prior tip. On settled implement and ready-repair iterations, record pre-iteration `HEAD`, detect non-ancestor moves after `executeWrite`, `git reset --keep` back, and log `agent_history_rewrite_reverted`.

- [x] [00 — iteration head guard module and awaitIteration wiring](./00-iteration-head-guard.md)
- [x] [01 — ready-repair regression and operator docs](./01-ready-repair-history-guard.md)
