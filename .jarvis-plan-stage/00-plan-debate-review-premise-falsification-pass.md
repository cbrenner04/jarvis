# Plan debate review premise-falsification pass

## Problem

Plans author invariant or rule-out acceptance criteria (*"rules out X"*, *"X may never equal Y"*) without establishing that the forbidden condition is reachable on the repository base today. Dead premises surface at implement time as unkillable guard hollow checkpoints — the wrong repair (amend the criterion instead of rescope the spec). Hollow-pin review catches referential misses; it does not catch unreachable guard premises.

## Decisions

- Plan debate review gains an **advisory** premise-falsification pass: flag invariant/rule-out-shaped criteria in `## Acceptance criteria` that cite no reachable violation on the base — rules out discovering a dead premise only after implement runs. Surfacing is `REVIEW_PASS_CONTEXT` injection into plan debate roles, not a plan-draft validator, completion blocker, or hard rejection; implement-time mutation verification remains the hard gate for guard killability.
- Detection and `buildPlanReviewPassContext` wiring live in `shared/prompts/review-plan.ts` with heuristic helpers colocated in `shared/` (same seam as hollow-pin) — rules out duplicating the check in the intent-split prompt or debate-only judgment with no testable detector.
- Scan scope matches hollow-pin: walk `## Acceptance criteria` checklist blocks in staged spec `.md` files only (exclude `index.md`, `intent.md`, nested paths, and other sections); skip human-only blocks via `parseSpec` / `isHumanOnlyCriterion` parity with `shared/mutation-checkpoint-criteria.ts`.
- Reuse shared `## Acceptance criteria` block parsing from `shared/mutation-checkpoint-criteria.ts` (export the block walker if still private) — rules out divergent scan boundaries between hollow-pin and premise passes.
- **Selection shape** (static patterns on assembled criterion blocks): treat a criterion as premise-bearing when its text matches invariant/rule-out phrasing (e.g. `may never`, `must not`, `rules out`, `neither … may equal`, `cannot occur`) — rules out flagging ordinary behavioral outcomes that do not assert an unreachable guard.
- **Reachability citation** (static, advisory): a premise-bearing criterion is **not** flagged when its assembled block cites a reachable violation on the base via at least one of: a backticked pinning or regression test path naming the failure scenario, a backticked production source path with an explicit violation hook, or prose that states reachability on the base (`reachable on`, `fails against the pre-fix`, `constructible on main`, or equivalent). Test-file tokens alone do not satisfy reachability when they only name a pinning file without a failure scenario — rules out treating any backtick as proof.
- A flagged premise that would leave its subspec with zero remaining non-human-only acceptance criteria adds rationale text that the subspec would be empty if dropped — rules out review preserving scope by inventing filler work.
- `REVIEW_PASS_CONTEXT` composes non-destructively with hollow-pin: when premise findings exist inject `## Unfalsifiable premises` first; hollow-pin keeps `## At-risk hollow pins` second; empty sections omitted; clean snapshot yields empty `REVIEW_PASS_CONTEXT` — rules out a later lander clobbering hollow-pin findings.
- Debate adversary prompt gains a short instruction to surface injected unfalsifiable-premise findings; advocate and adjudicator receive enriched `REVIEW_PASS_CONTEXT` only — rules out a fourth bespoke debate role.
- Out of scope: intent-split prompt; mutation-checkpoint selection and directive resolution (`mutation-checkpoint-verifier-trust`); keystone directives (`mutation-checkpoint-keystone`); v1 `buildReviewPrompt` wiring.

## Tasks

- Export or share `## Acceptance criteria` block parsing from `shared/mutation-checkpoint-criteria.ts` if premise detection cannot import it today.
- Add premise-falsification helpers (selection + reachability citation check + `formatUnfalsifiablePremisesSection`) in `shared/` and wire them from `shared/prompts/review-plan.ts` into `buildPlanReviewPassContext` ahead of hollow-pin composition.
- Extend `prompts/plan/review-adversary.md` with an unfalsifiable-premise reporting instruction; bump `revision` and regenerate `v1/test/fixtures/prompts/rendered/` entries covered by `rendered-snapshots.test.ts` when rendered bytes change.
- Add `shared/prompts/review-plan-premise-falsification.test.ts` with unreachable vs reachable fixtures, the retired fan-out subspec 00 replay, rendered-prompt assertions under `## Unfalsifiable premises`, and the mutation checkpoint in the test titled `flags an invariant criterion with no reachable violation on the base`.
- Update `v1/docs/spec-guidance.md`, `v2/docs/operator-runbook.md` § Gate trust, and `v2/docs/v1-behaviors.md` per Documentation updates.
- Run `bun run typecheck`, `bun run test:shared`, and `bun run test:v2`.

## Acceptance criteria

- [ ] `shared/prompts/review-plan-premise-falsification.test.ts` feeds an invariant criterion whose violation is unreachable on the base and asserts plan debate review rendering flags it under `## Unfalsifiable premises`; fails against the pre-fix review roles, which do not check premises.
- [ ] `shared/prompts/review-plan-premise-falsification.test.ts` feeds invariant criteria whose violations are reachable on the base and asserts no premise finding — the check does not fire on legitimate guards.
- [ ] `shared/prompts/review-plan-premise-falsification.test.ts` replays the retired fan-out subspec 00 criterion (*neither destination may equal the predecessor worktree*) and reports it as unfalsifiable.
- [ ] Mutation checkpoint: in `shared/prompts/review-plan-premise-falsification.test.ts`, the test titled `flags an invariant criterion with no reachable violation on the base` carries a `// @mutate` directive disabling the premise-falsification heuristic; the mutation turns that test RED.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:v2` exit zero.

## Documentation updates

- `v1/docs/spec-guidance.md` — under behavioral acceptance criteria or a sibling subsection: a criterion that rules out a condition must cite how that condition is reachable on the repository base today (call path, regression test, or constructible scenario); invariant guards without reachability evidence are plan-review findings, not implement-time proof-form fixes.
- `v2/docs/operator-runbook.md` § Gate trust — finalize the premise-smell bullet: plan debate review now falsifies unreachable invariant premises at plan time via `## Unfalsifiable premises`; delete the seed cleanup placeholder on that bullet; keep the operator revert-and-rescope guidance for implement-time discovery when review missed a premise.
- `v2/docs/v1-behaviors.md` — plan debate review injects `## Unfalsifiable premises` into `REVIEW_PASS_CONTEXT` for invariant criteria lacking a reachable violation citation on the base; composes ahead of `## At-risk hollow pins`.
