# Discard fix-up commits when the gate stays red

Quarantine fix-up edits on a stuck-red stop (exit 10): reset the PR branch to the
last green-completion state and force-push, leaving the original correct work
instead of a diff contaminated by flaky-gate-chasing edits.

- [ ] [00 - Discard fix-up commits on stuck-red stop](./00-discard-fixup-edits-on-stuck-red.md)
