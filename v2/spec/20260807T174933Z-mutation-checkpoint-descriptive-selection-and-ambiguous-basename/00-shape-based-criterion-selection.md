# Shape-based criterion selection

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`selectMutationCheckpointCriteria` selects any assembled AC block whose text contains the `Mutation checkpoint:` substring, so functional AC that documents checkpoint tokens as feature content is gated through pinning resolution it was never meant to satisfy. Guard selection already skips keystone-marked blocks; `Keystone checkpoint:` substring over-match is a separate mechanism in `selectKeystoneCheckpointCriteria`.

## Decision ledger

- Guard checkpoint selection accepts exactly three shapes on the assembled criterion block: (1) canonical suffix `` `pinFile` — `pinTitle`; Mutation checkpoint:`` (authoring contract per `subspecNaming` in `mutation-checkpoint-verifier.test.ts`), (2) prefix-first structured shape `` Mutation checkpoint: in `pinFile` test `pinTitle` `` (dominant corpus pattern — prose about a directive in the pinning file follows), or (3) a directive-shaped `// @mutate` occurrence (`DIRECTIVE_PATTERN`) — rules out retiring prefix-first without migration; rules out suffix-only narrowing that silently deselects real checkpoints.
- Keystone checkpoint selection requires the canonical suffix `` `pinFile` — `pinTitle`; Keystone checkpoint:`` on the assembled criterion block — rules out descriptive prose mentioning keystone markers in functional AC; `@mutate` in the block links the pin only.
- Selection requires pin linkage: structured prefix-first or canonical-suffix shapes must embed backticked pin file and pin title, or the block must contain `DIRECTIVE_PATTERN` — rules out selecting functional AC that quotes the canonical suffix template (`` `file` — `title`; Mutation checkpoint:``) as contract documentation without pin linkage.
- Bare `@mutate` prose without directive shape does not select a guard checkpoint — already handled today; unchanged.
- Genuine ticked guard and keystone checkpoints retain the existing apply/verify/refuse contract — rules out weakening real checkpoint gating while narrowing false positives.
- Narrowed guard selection changes `detectAtRiskHollowPinsInMarkdown` behavior in plan review — hollow-pin findings must remain correct after the selector change.

## Prerequisites

- `selectMutationCheckpointCriteria` and `selectKeystoneCheckpointCriteria` select ticked non-human-only criteria from assembled bullet blocks (`shared/mutation-checkpoint-criteria.ts`).
- Guard selection today uses `block.includes(CRITERION_MARKER)` substring matching — the live bug this subspec fixes; bare `@mutate` prose without directive shape is already excluded via `DIRECTIVE_PATTERN.test(block)`.
- Keystone selection today uses `block.includes(KEYSTONE_CRITERION_MARKER)` substring matching.
- `mutation-checkpoint-regression.test.ts` rows and `subspecNaming` suffix-first fixtures exercise production checkpoint shapes.

## Tasks

- In `shared/mutation-checkpoint-criteria.ts`, narrow guard selection to canonical suffix, prefix-first structured shape (`Mutation checkpoint: in \`pinFile\` test \`pinTitle\`` with both backticks present), or `DIRECTIVE_PATTERN`; require pin linkage so canonical-suffix-template prose alone does not select.
- Narrow keystone selection to canonical `` `pinFile` — `pinTitle`; Keystone checkpoint:`` suffix only.
- Add `write.test.ts` regression proving functional AC that mentions `@mutate`, `Mutation checkpoint:`, `Keystone checkpoint:`, and `` `write.test.ts` `` only as descriptive prose (no canonical checkpoint suffix, no prefix-first shape, no real `// @mutate` directive) completes without `contract_miss` on mutation-checkpoint parsing.
- Add `mutation-checkpoint-verifier.test.ts` regression proving functional AC that quotes the canonical suffix template as contract documentation without pin linkage does not select.
- Update `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria and `v2/docs/operator-runbook.md` § Gate trust for shape-based selection; update `v2/docs/v1-behaviors.md` implement-write mutation-checkpoint selection bullet.
- Run `bun run typecheck` and `bun run test:shared`.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `subspecNaming` suffix-first guard checkpoints and `mutation-checkpoint-regression.test.ts` rows still select and verify (preserved against pre-fix suffix-only narrowing).
- [ ] `mutation-checkpoint-verifier.test.ts` — prefix-first intent-style guard checkpoints (`Mutation checkpoint: in \`file\` test \`title\`` with linked pinning-file directive) still select and verify; fails against suffix-only narrowing.
- [ ] `mutation-checkpoint-verifier.test.ts` — `prose @mutate without a directive-shaped occurrence is not selected` and `a ticked criterion quoting a directive-shaped @mutate occurrence is still verified` stay green.
- [ ] `mutation-checkpoint-verifier.test.ts` — `canonical suffix template quoted as contract prose does not select` proves a ticked criterion quoting `` `file` — `title`; Mutation checkpoint:`` as documentation without pin linkage produces no `hollow`, `caught`, or pinning-resolution unparseable entries; fails pre-fix.
- [ ] `v2/src/execution/write.test.ts` — `functional AC mentioning checkpoint tokens descriptively does not contract_miss` embeds a subspec whose functional AC mention `@mutate`, `Mutation checkpoint:`, `Keystone checkpoint:`, and `` `write.test.ts` `` only as descriptive prose (no canonical checkpoint suffix, no prefix-first shape, no real `// @mutate` directive) and asserts implement completion does not settle `contract_miss` for mutation-checkpoint parsing; fails pre-fix.
- [ ] `v2/src/execution/write.test.ts` — `functional AC mentioning checkpoint tokens descriptively does not contract_miss`; Mutation checkpoint: its pinning test carries `// @mutate shared/mutation-checkpoint-criteria.ts` inverting the criterion-selection shape guard using a uniquely occurring anchor in landed code; the mutation turns the AC-5 regression RED.
- [ ] `shared/prompts/review-plan-hollow-pin.test.ts` stays green after narrowed guard selection (hollow-pin plan-review surface preserved).
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria documents prefix-first and canonical-suffix guard shapes, descriptive checkpoint-token mentions in functional AC without selection, and that canonical `` `file` — `title`; Mutation checkpoint:`` / `` `file` — `title`; Keystone checkpoint:`` suffix remains the preferred authoring contract.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents that descriptive criteria mentioning checkpoint tokens without canonical checkpoint shape or prefix-first pin linkage no longer select.
- [ ] `v2/docs/v1-behaviors.md` implement-write mutation-checkpoint bullet records shape-based guard/keystone selection.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — prefix-first (`Mutation checkpoint: in \`file\` test \`title\``) and canonical-suffix guard shapes; functional AC may mention checkpoint tokens descriptively without selecting; canonical suffix remains the preferred authoring contract.
- `v2/docs/operator-runbook.md` § Gate trust — descriptive criteria mentioning checkpoint tokens without canonical checkpoint shape or prefix-first pin linkage no longer select.
- `v2/docs/v1-behaviors.md` — implement-write mutation-checkpoint selection bullets.
