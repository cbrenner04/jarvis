---
name: plan-draft-contract-miss-reprompts-before-blocking
---

# Plan-draft normalizer contract_miss reprompts the drafter once before settling blocked

## Problem

A plan write step whose staged tree fails a normalizer contract (e.g. a multi-surface `## Acceptance criteria` bullet) settles `blocked` / `contract_miss`, `resumable: false`, immediately. The violation is a one-bullet fix the drafting agent could make in seconds, but there is no repair arm — the operator relaunches the whole plan workflow and pays a fresh draft plus latency. The write loop already owns reprompt machinery for missing tokens, missing blockers, and landing-contract/staged-lint violations; draft-contract misses are the one contract class with no reprompt.

## Evidence (2026-08-29)

Two of three plan dispatches in one session first-failed on the same contract: run `cd88e077` (`plan/terminal-invocation-failure-persists-stderr`) and run `aeb4040e` (`plan/invocation-failure-stderr-in-run-errors`), both `contract_miss` naming a multi-surface AC bullet, both fixed by a from-scratch relaunch that drafted clean. Cost per miss: one full plan-draft invocation, plus operator intervention, ~10 min latency each.

## Evidence (2026-09-11) — 3 of 3 plan lanes, one shape

Every plan lane dispatched in the session failed this way, and all three were the *same* drafter drift rather than three different contract violations: the agent drafts a subspec, renames it, writes the new file, and leaves the old one on disk. The index correctly links the keeper, so `artifact.exists` blocks on the orphan.

| Lane | `contractMissDetail` | Orphan left beside the keeper |
| --- | --- | --- |
| `plan/cleanup-archives-hand-landed-specs` | `Plan index does not link 00-archive-complete-in-repo-specs-without-run-rows.md` | keeper `00-run-row-free-in-repo-archival.md` |
| `plan/pipeline-list-rpc-terminal-retention` | `Plan index does not link 00-bound-default-pipeline-list-terminal-history.md` | keeper `00-pipeline-list-terminal-retention.md` |
| `plan/bulk-terminal-run-dismissal-store` | `Plan index does not link 00-bulk-terminal-run-dismissal-store.md` | keeper `00-bulk-terminal-run-dismissal.md` |

Deleting the orphan corrected all three trees with no other edit. The draft prompt already carries the rule the drafter broke ("If you draft a subspec and then rename or rewrite it, delete the old file"), which is the point: a prompt rule is not holding this invariant, and the repair is one `rm` the drafter could perform on a reprompt. Two of the three then landed through `jarvis pipeline recover`; the third could not be recovered at all (see [[recover-needs-no-predecessor-artifact]]) and its plan was hand-landed as [#3784](https://github.com/cbrenner04/jarvis/pull/3784).

Consider naming the unlinked-staged-subspec shape specifically in the reprompt: the detail names the file the index *fails* to link, which reads as "add a link" when the correct repair is usually "delete the stale file".

## Decisions

- On a plan-draft step `contract_miss`, spend one bounded reprompt to the same binding chain quoting the failed contract id and `contractMissDetail` verbatim, asking for a staged-tree fix only; re-run the contract evaluation after. Mirrors the existing `landing_contract_reprompt` shape. Rules out unbounded repair loops.
- A second miss settles the current `blocked` / `contract_miss` outcome unchanged; the reprompt attempt is visible in the run log. Rules out masking a drafter that cannot satisfy the contract.
- Scope is the plan-draft write step's normalizer contracts; intent-split contracts join only if the same recurrence is observed there. Rules out speculative generalization.

## Acceptance criteria

- [ ] A write-path test proves a plan-draft `contract_miss` triggers exactly one reprompt carrying the failed contract id and detail, and a staged fix that passes re-evaluation settles the step's normal complete path; it fails against the current immediate-settle behavior.
- [ ] A companion test proves a second consecutive miss settles `blocked` / `contract_miss` with the same operator-visible detail as today, with the reprompt recorded in the run log.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — add the draft-contract reprompt to the reprompt inventory (token, blocker, landing, draft-contract).
- `v2/docs/operator-runbook.md` — note plan `contract_miss` now means the drafter failed the contract twice.
