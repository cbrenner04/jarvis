# Terminal publication records a successful ready flip

Pipeline terminal publication must persist harness ready-flip evidence on the owning run row after `gh pr ready` succeeds so later republication can match lineage evidence to the PR this lane flipped. Depends on [ready-flip evidence persistence](../20260930T060301Z-ready-flip-evidence-persistence/index.md) for the store column and ops.

## Subspecs

- [ ] [00 — Terminal publication writes ready-flip evidence after flip success](./00-terminal-publication-writes-ready-flip-evidence.md)
