# Implement review falsifiability fragment

## Problem

Implement review critic, adversary, and advocate prompts tell agents to review the spec and branch diff and emit verdicts but not what to check; plausible reviews pass while ticked acceptance criteria cite tests that would not fail against pre-change code.

## Decision ledger

- Add one shared fragment (`implement.review.falsifiability`, orphan lane `behavior: implement-review-falsifiability` — same pattern as `implement.rules` on `implement-rules`) with generic per-ticked-criterion falsifiability checks, “passes before and after” as a finding, a short defect-shape taxonomy, and reinforcement of empty verdict when nothing real is found; rules out pasting duplicate prose into the three step bodies or inheriting the fragment on every `behavior: implement` step.
- Wire the fragment only into `implement.prompt.review.critic`, `.adversary`, and `.advocate` via frontmatter `add: [implement.review.falsifiability]`; leave `implement.prompt.review.adjudicator` and implement write/shrink steps without it — rules out adjudicator prompt churn and automatic write-step inheritance.
- Pair falsifiability obligations with the existing empty-verdict contract on critic/adversary/advocate — rules out manufactured findings when nothing real is wrong.
- Out of scope: pre-change source tool access; changing `BRANCH_DIFF` span or merge-base diff mechanics; plan or intent review roles; adjudicator prompt changes.

## Fragment content contract

Prose is target-repo-neutral (no repo, module, PR, or issue identifiers). It must tell reviewers to:

- For each ticked acceptance criterion in the completed spec, judge whether the cited evidence (named test, path pin, or stated verification) would fail against the pre-change code implied by the branch diff context.
- Treat a criterion whose cited evidence would pass before and after the change as a finding in itself.
- Scan for generic defect shapes (not a checklist to recite): fail-open where the spec says fail closed; a branch made unreachable by an earlier short-circuit while a criterion claims coverage; a value computed or persisted then ignored by its consumer; a test that re-derives the production rule instead of asserting the intended outcome independently; a predicate correct for one input and wrong for several when fixtures only exercise one.
- When no real defect is found: the critic emits an empty verdict; the adversary reports no manufactured problems; the advocate concedes only findings the evidence supports — consistent with existing role contracts.

Deferred to first consumer: exact subsection headings and bullet wording inside the fragment body — pin when render tests need stable slices beyond substring guards.

## Tasks

- Add `prompts/implement/review-falsifiability.md` (`id: implement.review.falsifiability`, `kind: fragment`, `behavior: implement-review-falsifiability`, `revision: 1`) with the fragment content contract above; register it in `prompts/registry.txt`.
- Add `add: [implement.review.falsifiability]` to `prompts/implement/review-critic.md`, `review-adversary.md`, and `review-advocate.md`; bump each step `revision`; do not edit `review-adjudicator.md`.
- Add `shared/prompts/review-falsifiability-fragment.test.ts` with tests `implement review falsifiability guidance is defined only on the shared fragment` (fails when the same prose is copy-pasted into any of the three implement review step bodies) and `review falsifiability fragment has no project-specific identifiers` (fails when the fragment body contains `jarvis`, a `v2/` or `shared/` path, a `prompts/` path, or a `#<digits>` issue/PR reference).
- Extend `shared/prompts/review-implement.test.ts` with test `implement review critic, adversary, and advocate renders include falsifiability mandate, defect-shape taxonomy, and empty-verdict-when-nothing-found` asserting fully rendered prompts for all three roles; fails against the pre-change prompt corpus.
- Register render-observer map entries in `shared/prompts/render-observer-tests.ts`: map `prompts/implement/review-falsifiability.md` to `shared/prompts/review-falsifiability-fragment.test.ts` and `shared/prompts/review-implement.test.ts`; include `shared/prompts/review-falsifiability-fragment.test.ts` in the observer lists for `prompts/implement/review-critic.md`, `review-adversary.md`, and `review-advocate.md` (alongside existing review-implement observer tests).
- Update `v2/docs/prompts.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/workflow-runner.md` per documentation updates below.

## Acceptance criteria

- [x] The shared review falsifiability fragment is registered and assembles into rendered implement review critic, adversary, and advocate prompts; pinned by the registered render-observer map entries for `prompts/implement/review-critic.md`, `review-adversary.md`, and `review-advocate.md`.
- [x] `shared/prompts/review-implement.test.ts` test `implement review critic, adversary, and advocate renders include falsifiability mandate, defect-shape taxonomy, and empty-verdict-when-nothing-found` fails against the pre-change prompt corpus.
- [x] `shared/prompts/review-falsifiability-fragment.test.ts` test `implement review falsifiability guidance is defined only on the shared fragment` fails when the same prose is copy-pasted into any of the three implement review step bodies.
- [x] `shared/prompts/review-falsifiability-fragment.test.ts` test `review falsifiability fragment has no project-specific identifiers` fails when the fragment body contains `jarvis`, a `v2/`, `shared/`, or `prompts/` path, or a `#<digits>` reference.
- [x] `shared/prompts/review-implement-contract-preservation.test.ts` test `implement review role contract substrings preserved` stays green (unchanged raw implement review step bodies: read-only, merge-base diff markers, role-specific verdict/I/O substrings pinned in that file).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.
- [x] `bun run test:shared` and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/prompts.md` — register the orphan-lane falsifiability fragment and `add:` assembly on implement review critic, adversary, and advocate (same pattern as `implement.rules`); drop the "no live step uses it today" note on `add:`.
- `v2/docs/v1-behaviors.md` — implement review prompt content now includes falsifiability review checks.
- `v2/docs/workflow-runner.md` — what implement review roles are asked to check, not only I/O and rendering; implement-review falsifiability is judgment from merge-base diff plus ticked acceptance criteria, not pre-change source execution or mechanically guaranteed detection.
