# 00 — Superseded-pipeline branch retirement

## Problem

Bulk cleanup refuses branches whose stage PRs were closed without merge even when terminal publication already superseded them with a merged final PR and left the settlement comment on the closed PR.

## Decision ledger

- Third retirement authority applies after merged-PR authority fails and, for `plan/*`, after plan-lane subsumed authority fails — rules out skipping merged hygiene or in-repo plan subsumed paths when those authorities already apply.
- Proof uses the closed (not merged) PR whose `headRefOid` equals the candidate local head: no OPEN PR on the branch (`gh pr list --head` probe; probe failure → ineligible, not “closed”), exactly one such closed PR owns the head, and an issue comment on that PR has body exactly `Superseded by #<n> (pipeline <pipelineId>, stage <stageId>)` matching terminal supersede settlement in `pipeline-execution.ts` — rules out free-form “superseded” text or comments on the successor PR only.
- Referenced `#<n>` must resolve to a same-repository PR in `MERGED` state with `mergedAt` set; open, closed-without-merge, missing, or cross-repo references → ineligible — rules out retiring on a draft terminal or a manually closed successor.
- Worktree retirement and worktree-independent merged-branch ref discovery/prune share one exported proof predicate (parallel to `mergedPrHeadAuthorityMatches`); ref candidates admit when merged-PR authority or supersede proof passes — rules out head-only branches staying orphaned while their worktree retires.
- Shared guards unchanged: non-terminal durable run, daemon-live run, daemon-unreachable fail-closed, apply-time eligibility and ref-prune recheck, merged-worktree dirty classification, local-only ref deletion — rules out weakening existing abandonment safety.
- Supersede retirement does not set `skipSpecArchival` unless plan-lane subsumed authority already did; post-removal archival follows merged retirement when a provable artifact exists — rules out skipping implement/spec archival solely because the lane PR closed via supersede.

## Work

- Add supersede-proof parsing and `gh` probes (closed PR head match, comment body, successor merge state) in `v2/src/commands/cleanup.ts`.
- Wire proof into `checkEligibility` after merged and plan-lane subsumed attempts; extend merged-branch ref discovery and apply-time authority recheck to accept supersede proof.
- Extend `cleanup.test.ts` with stubbed `gh` fixtures for success and each broken proof component.

## Acceptance criteria

- [ ] `cleanup.test.ts` proves dry-run preview and apply retirement of a materialized worktree whose branch has a closed head-owning PR with settlement comment and merged successor, and proves ref discovery/prune for a head-only branch under the same proof; proves a merely closed PR without settlement proof and each broken proof component (OPEN PR, list/comment/view probe failure, head OID mismatch, absent or non-exact comment, unmerged or non-merged successor) remain ineligible; fails against the pre-fix baseline.
- [ ] `cleanup.test.ts` `merged plan worktree with landed criteria-only dirt retires safely`, `merged local head candidate requires matching merged PR head`, and `default merged-worktree retirement prunes origin tracking ref` stay green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- [ ] `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — superseded-pipeline authority (proof components, evaluation order after merged and plan-lane subsumed, ref-prune parity, fail-closed refusals); local-only scope unchanged.
- [ ] `v2/docs/v1-behaviors.md` — bulk cleanup superseded-pipeline retirement authority (cross-link runbook gate).
