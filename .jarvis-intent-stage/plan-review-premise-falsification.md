---
name: plan-review-premise-falsification
---

# Plan debate review falsifies unreachable invariant premises

Plans author *"rules out X"* / *"X may never equal Y"* criteria without checking that X is reachable on `main` today. Wrong premises surface as unkillable guard hollow checkpoints at implement time — the wrong repair. This intent covers the plan-review seam; keystone implement-time backstop is a separate execution-loop intent.

## Decisions

- Plan debate review gains a required premise-falsification pass: for every criterion asserting an invariant or ruling out a condition, the reviewer must establish the violation is reachable on the repository base today (call path or constructible scenario); unreachable violations are rewritten or dropped before the spec lands — rules out discovering a dead premise only after implement runs.
- Premise-falsification lands in plan debate review roles via `shared/prompts/review-plan.ts`, not the intent-split prompt — rules out the wrong seam and duplicating hollow-pin in split prose.
- A dropped premise that leaves the subspec empty is reported as such rather than replaced with filler — rules out review preserving scope by inventing work.
- Scan scope matches hollow-pin: `## Acceptance criteria` checklist blocks in staged spec `.md` files only (exclude `index.md`, `intent.md`, other sections); skip human-only blocks.
- `REVIEW_PASS_CONTEXT` composes non-destructively with the hollow-pin sibling (`## At-risk hollow pins` section): inject a named premise section when findings exist, empty when clean — rules out a later lander clobbering hollow-pin findings.
- Debate adversary prompt instructs surfacing injected unfalsifiable-premise findings; advocate and adjudicator receive enriched `REVIEW_PASS_CONTEXT` only — rules out a fourth bespoke debate role.
- Out of scope: intent-split prompt; mutation-checkpoint selection and directive resolution (`mutation-checkpoint-verifier-trust`); keystone directives (separate intent).

## Acceptance criteria

- [ ] A plan debate review over a spec containing an invariant criterion whose violation is unreachable on the base reports that criterion as unfalsifiable and names it; a regression fails against the current review roles, which do not check premises.
- [ ] A plan debate review over a spec whose invariant criteria are all reachable reports no premise finding — the check does not fire on legitimate guards.
- [ ] Replaying the retired fan-out subspec 00 criterion (*neither destination may equal the predecessor worktree*) through the plan review reports it as unfalsifiable.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:v2` exit zero.

## Documentation updates

- `v1/docs/spec-guidance.md` — a criterion that rules out a condition must cite how that condition is reachable today.
- `v2/docs/operator-runbook.md` § Gate trust — finalize premise-smell guidance (plan review now falsifies unreachable premises at plan time; delete the seed cleanup placeholder on the premise-smell bullet).

## Prerequisites

- Plan debate review roles render via `shared/prompts/review-plan.ts` with `REVIEW_PASS_CONTEXT` injection for debate passes.
- Plan debate review hollow-pin pass injects `## At-risk hollow pins` via non-destructive `REVIEW_PASS_CONTEXT` composition.
- `## Acceptance criteria` checklist block parsing for staged spec files is shared between review-plan and the mutation-checkpoint verifier (`shared/mutation-checkpoint-criteria.ts` or equivalent).
