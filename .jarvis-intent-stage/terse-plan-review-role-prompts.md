---
name: terse-plan-review-role-prompts
---

# Terse plan review role prompts

## Problem

Plan debate and light review roles (`prompts/plan/review-*.md`) repeat per-section delimiter explanations and long identify lists while the intent review family expresses the same skeleton at roughly a third the size. The prose renders on every plan review cycle.

## Decision ledger

- Rewrite all five `plan.prompt.review.*` role bodies in the intent-family style: terse role header, bare data blocks, short Rules; rules out keeping four verbose plan-specific skeletons.
- Compress each role's instruction list to what that role uniquely owns (adversary: findings; advocate: dispositions per finding; adjudicator: self-contained outcome verdict; critic: light-path verdict; actuator: landing actions); rules out duplicating adversary lists in critic.
- Preserve load-bearing contracts verbatim: adversary injected-findings hooks (`## Unfalsifiable premises`, `## At-risk hollow pins`), oversized-subspec split requirement, self-contained-verdict and empty-verdict semantics, and read-only/write boundaries; rules out losing machine-consumed hooks in a prose diet.
- Keep placeholders, ids, profile wiring, and render path unchanged; rules out coupling the prose diet to harness changes.
- Record pre-rewrite body lengths and pin each rewritten body below its baseline; rules out silent prompt growth.

## Acceptance criteria

- [ ] `shared/prompts/review-plan-premise-falsification.test.ts`, `shared/prompts/review-plan-hollow-pin.test.ts`, and `shared/prompts/review-profile.test.ts` stay green with unchanged `plan.prompt.review.*` placeholder declarations.
- [ ] Rewritten plan adversary, adjudicator, advocate, critic, and actuator bodies still contain the contract substrings above; a regression removing any pinned hook fails against the pre-fix prompts.
- [ ] A growth-budget test records each plan review role's pre-rewrite body length and asserts the rewritten body is strictly smaller; it fails when a body is not shortened.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

## Prerequisites
