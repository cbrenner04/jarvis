# Terminal publication accepts an operator-merged PR

When terminal publication runs after the operator already merged the implement PR, probing PR state before the ready gate must short-circuit success; a closed unmerged PR must fail with `pr_closed` without calling `gh pr ready`.

## Subspecs

- [x] [00 — Terminal publication PR-state probe](./00-terminal-publication-pr-state-probe.md)
