---
name: quarantine-fixup-edits-on-stuck-red
---

# Discard fix-up commits when the gate stays red, instead of shipping a contaminated PR

## Problem

When the fix-up loop exhausts its budget against a red gate (stuck-red / changing-failure bound,
exit 10), the fix-up edits chasing the failure are left on the PR. Observed in groceries #14: the
spec change was correct, but flaky-gate-chasing edits contaminated the diff and had to be salvaged
by hand.

## Behavior

When the fix-up loop terminates still-red at its bound, discard the commits the fix-up iterations
added (restoring the diff to the last green-completion state) rather than leaving them on the PR.
Surface a message that names the ambiguity — gate red after N tries, flaky or real, finalize by
hand — distinct from a normal completion. The PR is left with the original correct work, not the
chase edits.

## Out of scope

- Retrying the gate before the loop starts (separate behavior).
- Deciding whether the red is flaky vs real — the operator finalizes by hand.

## Prerequisites
