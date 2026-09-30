# Completion republication re-drafts harness-ready PRs

When completion republication hits a sole open non-draft PR this lane previously flipped ready, auto `gh pr ready --undo` and reuse that PR instead of `OpenPrNotDraftError`. Depends on [ready-flip evidence persistence](../20260930T060301Z-ready-flip-evidence-persistence/index.md) (lineage lookup), [terminal publication records ready-flip](../20260930T064522Z-terminal-publication-records-ready-flip/index.md) (evidence after successful pipeline `gh pr ready`), and implement-lane ready-finalization recording harness ready-flip evidence after a successful write-loop `gh pr ready` — republication undo needs evidence from whichever path flipped the PR.

- [x] [00-republication-undoes-harness-ready-flip.md](./00-republication-undoes-harness-ready-flip.md)
- [ ] [01-terminal-publication-accepts-harness-ready-pr.md](./01-terminal-publication-accepts-harness-ready-pr.md)
