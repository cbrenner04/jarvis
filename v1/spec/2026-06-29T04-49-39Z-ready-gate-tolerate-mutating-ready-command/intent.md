---
name: ready-gate-tolerate-mutating-ready-command
---

# Ready-gate: tolerate mutating readyCommand output

## Problem

After green verification, `full`-tier gate throws `ReadyVerificationDirtyError` when porcelain is non-empty. Legitimate `readyCommand` side effects (coverage threshold auto-update, snapshot regen) always dirty the tree, so the gate can never finalize even when verification passed.

## Direction

Stop treating all post-verification dirt as operator error. Either extend the existing pre-ready auto-commit path to absorb verification-produced churn, or add a configured expected-dirty allowlist — plan picks one.

## Decisions

- Green verification followed by expected churn must not abort before `gh pr ready` — rules out unconditional `ReadyVerificationDirtyError` on mutating `readyCommand`.
- Unexpected post-verification dirt still aborts the gate — rules out blind commit-all after every green verify.
- Repos with non-mutating `readyCommand` and clean post-verify trees keep current behavior — rules out gate churn on the common path.
- Chosen mechanism applies at every `full`-tier gate site that runs `readyCommand` verification — rules out completion-only fix.

Deferred to first consumer: auto-commit extension vs expected-dirty allowlist — pin when the plan drafts the spec.

## Documentation updates

- `v2/docs/v1-behaviors.md` — post-verification churn handling and updated gate ordering.
- `v1/docs/operator-runbook.md` — The gate section: when harness commits after verification.

## Prerequisites
