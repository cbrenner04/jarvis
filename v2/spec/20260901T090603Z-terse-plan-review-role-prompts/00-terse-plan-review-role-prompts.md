# Terse plan review role prompt bodies

## Problem

Plan debate and light review roles (`prompts/plan/review-*.md`) repeat per-section delimiter explanations and long identify lists on every plan review cycle while the intent review family (`prompts/intent/review-*.md`) expresses the same skeleton at roughly a third the size.

## Decision ledger

- Rewrite all five `plan.prompt.review.*` registry bodies in the intent-family style (terse role header, bare data blocks, short Rules); rules out keeping four verbose plan-specific skeletons with repeated delimiter prose.
- Compress each role's instruction list to what that role uniquely owns (adversary: findings; advocate: dispositions per finding; adjudicator: self-contained outcome verdict; critic: light-path editorial verdict; actuator: verdict landing actions); rules out duplicating adversary identify lists in critic.
- Preserve load-bearing contracts verbatim: adversary injected-findings hook (`Unfalsifiable premises listed in Context under \`## Unfalsifiable premises\``), adversary structural **product** flagging, oversized-subspec split requirement, advocate per-finding disposition, adjudicator self-contained-verdict and empty-verdict semantics, actuator verdict-application bullet for Rewrite structural **product**, critic light-path editorial scope without adversary-style identify lists, and read-only/write boundaries; rules out losing machine-consumed hooks in a prose diet.
- Leave frontmatter `id`, `placeholders`, `behavior`, `kind`, and `remove` arrays, profile wiring, and `shared/prompts/review-plan.ts` render path unchanged; rules out coupling the prose diet to harness changes.
- Pin pre-rewrite body lengths as constants and require each rewritten body to be strictly shorter; rules out silent prompt growth or length-neutral rewrites that only reshuffle verbosity.

## Pre-rewrite body length baselines

Artifact body bytes after frontmatter (`registry.getById(...).artifact.body.length`, measured at spec draft time):

- `plan.prompt.review.adversary`: 2392
- `plan.prompt.review.advocate`: 2232
- `plan.prompt.review.adjudicator`: 2893
- `plan.prompt.review.critic`: 2312
- `plan.prompt.review-actuator`: 2513

## Tasks

- Add `shared/prompts/review-plan-growth-budget.test.ts` exporting per-role baseline constants; add test `plan review role body growth stays within budget` asserting each registry `artifact.body.length` is strictly less than its baseline, and test `plan review role placeholders unchanged` asserting each role's frontmatter `placeholders` array is byte-identical to the pre-rewrite declaration.
- Add `shared/prompts/review-plan-contract-preservation.test.ts` with test `plan review role contract substrings preserved` asserting adversary structural **product** flagging, advocate per-finding disposition, adjudicator self-contained verdict and empty-verdict semantics, oversized-subspec split language on adversary/advocate/adjudicator/actuator, and critic editorial scope without adversary-style identify lists; it fails against the pre-fix prompts when a contract substring is removed.
- Wire `shared/prompts/review-plan-growth-budget.test.ts` and `shared/prompts/review-plan-contract-preservation.test.ts` in `shared/prompts/render-observer-tests.ts` for each changed `prompts/plan/review-*.md` (including `review-adjudicator.md` and `review-actuator.md`, which lack entries today).
- Rewrite `prompts/plan/review-adversary.md` body to match intent-family terse shape; drop repeated "The text between …" delimiter explanations; keep adversary-specific finding obligations including the `## Unfalsifiable premises` hook, structural **product** flagging, and oversized-subspec identification; bump `revision`.
- Rewrite `prompts/plan/review-advocate.md` body likewise; keep per-finding disposition and oversized-subspec assessment obligations only; bump `revision`.
- Rewrite `prompts/plan/review-adjudicator.md` body likewise; keep self-contained verdict, empty-verdict, and oversized-subspec split obligations; bump `revision`.
- Rewrite `prompts/plan/review-critic.md` body likewise; keep light-path editorial verdict scope without adversary-style identify lists; bump `revision`.
- Rewrite `prompts/plan/review-actuator.md` body likewise; keep write-boundary and verdict-application mechanics including `Rewrite structural **product**` and oversized-subspec split on verdict; bump `revision`.
- Bump revision on the four v1-snapshotted roles (`adversary`, `advocate`, `adjudicator`, `actuator`); update `v1/test/prompts/rendered-snapshots.test.ts` revision expectations; regenerate `v1/test/fixtures/prompts/rendered/plan.prompt.review.*@r*.shared.txt` fixtures.

## Acceptance criteria

- [x] `shared/prompts/review-plan-growth-budget.test.ts` test `plan review role body growth stays within budget` measures each `plan.prompt.review.*` registry `artifact.body.length` (post-frontmatter body bytes) and asserts strictly less than its pinned pre-rewrite baseline; it fails against the pre-fix prompts.
- [x] `shared/prompts/review-plan-growth-budget.test.ts` test `plan review role placeholders unchanged` asserts each `plan.prompt.review.*` frontmatter `placeholders` array matches the pre-rewrite declaration; it fails when any binding changes.
- [x] `shared/prompts/review-plan-contract-preservation.test.ts` test `plan review role contract substrings preserved` fails against the pre-fix prompts when adversary structural **product** flagging, advocate per-finding disposition, adjudicator self-contained verdict or empty-verdict semantics, oversized-subspec split language on any debate/actuator role, or critic editorial scope is removed or adversary-style identify lists are reintroduced.
- [x] `shared/prompts/review-plan-premise-falsification.test.ts` stays green.
- [x] `shared/prompts/review-plan-hollow-pin.test.ts` stays green.
- [x] `shared/prompts/review-profile.test.ts` stays green.
- [x] `v1/test/prompts/rendered-snapshots.test.ts` stays green against regenerated revision-keyed fixtures for `plan.prompt.review.adversary`, `plan.prompt.review.advocate`, `plan.prompt.review.adjudicator`, and `plan.prompt.review-actuator`.
- [x] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

None — prompt ids, placeholders, profile wiring, and render path are unchanged; load-bearing review contracts are preserved in template bodies and pinned by contract-preservation tests.
