---
name: plan-draft-contract-miss-reprompt
---

# Plan-draft contract_miss reprompts the drafter once before settling blocked

Unsplit rationale: the whole change lives in the write loop's reprompt/settle arm for plan-draft normalizer contracts — one module-boundary surface, no persistence, daemon, or CLI change.

## Primary implementation surface

- `v2/src/execution/write-loop.ts` (draft-contract evaluation and reprompt arm)

## Problem

A plan write step whose staged tree fails a normalizer contract settles `blocked` / `contract_miss`, `resumable: false`, immediately — no repair arm. Observed misses are mechanical one-file fixes (most often an orphaned renamed subspec the index no longer links), yet the operator pays a full redraft and ~10 min latency, and a standalone (non-pipeline) lane cannot be recovered at all. The loop already reprompts for missing tokens, missing blockers, and landing-contract/staged-lint violations; draft contracts are the one class with no reprompt.

## Decisions

- On a plan-draft `contract_miss`, spend exactly one bounded reprompt to the same binding chain, quoting the failed contract id and `contractMissDetail` verbatim, asking for a staged-tree fix only; re-evaluate the contract after. Mirrors `landing_contract_reprompt`. Rules out unbounded repair loops.
- The reprompt names the unlinked-staged-subspec shape explicitly: when the detail says the index does not link a file, the likely repair is deleting the stale renamed file, not adding a link.
- A second miss settles the existing `blocked` / `contract_miss` outcome unchanged, with the reprompt attempt recorded in the run log. Rules out masking a drafter that cannot satisfy the contract.
- Scope is the plan-draft write step's normalizer contracts only; intent-split contracts join only if the same recurrence is observed there.

## Acceptance criteria

- [ ] A write-loop test proves a plan-draft `contract_miss` triggers exactly one reprompt carrying the failed contract id and detail, and that a staged fix passing re-evaluation settles the step's normal complete path; it fails against the current immediate-settle behavior.
- [ ] A companion test proves a second consecutive miss settles `blocked` / `contract_miss` with the same operator-visible detail as today, with the reprompt recorded in the run log.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — add draft-contract to the reprompt inventory (token, blocker, landing, draft-contract).
- `v2/docs/operator-runbook.md` — plan `contract_miss` now means the drafter failed the contract twice.
- `v2/docs/v1-behaviors.md` — record the changed plan-draft contract-miss settle behavior.

## Prerequisites

- The write loop reprompts a staged-tree violation to the same binding chain and re-evaluates before settling (landing-contract reprompt).
- Plan-draft normalizer contract failures settle `contract_miss` and persist a `contract_miss_detail` log event.
