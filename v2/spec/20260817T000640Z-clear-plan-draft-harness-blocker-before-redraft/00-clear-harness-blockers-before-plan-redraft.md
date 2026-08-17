# Clear harness blockers before plan redraft

## Problem

A preserved plan-draft stage can contain normalizer diagnostics appended as harness blockers. The next otherwise-valid draft is then rejected by the unchanged prerequisite-blocker contract as `plan.draft.blocker`, and the prior normalizer reasons are unavailable to the redraft.

## Decision ledger

- `Artifact contract check failed:` is a reserved harness-only marker. In staged `intent.md`, every exact `## Blocker` section whose trimmed body starts with that marker, including a marker with no payload, is harness-authored; all non-matching blocker sections remain agent-authored. A marker-prefixed agent block is therefore not distinguishable and is reserved to the harness.
- The plan-draft path examines only staged `intent.md`, the sole file to which the normalizer appends these markers, and processes matching sections top-to-bottom. That order is the canonical staged-file order for these diagnostics.
- Removing a matching section removes its heading and full body. Its diagnostic payload is the text after the first marker, trimmed at both ends while preserving all interior whitespace and newlines exactly; an empty payload remains one empty diagnostic. Non-matching sections and their relative order remain unchanged.
- When one or more diagnostics are removed, both preserved-attempt prompt branches append exactly one `## Prior harness normalizer diagnostics` section. It contains one numbered `<<<HARNESS_NORMALIZER_DIAGNOSTIC n BEGIN>>>` / `<<<HARNESS_NORMALIZER_DIAGNOSTIC n END>>>` data zone per payload, in source order, separated by one blank line; no such section is rendered when none were removed.
- Collection and stripping occur immediately before the selected preserved-attempt prompt is rendered. Diagnostics are one-shot attempt-local context: if rendering or invocation fails, the cleared stage is retained and those prior diagnostics are not replayed on a later attempt; a later normalizer rejection creates and carries only its newly appended harness blockers. This rules out persistence or daemon changes.
- Apply preparation before choosing either `plan.prompt.draft` or `write.staged-markdown-lint-reprompt`, so ordered diagnostics reach every preserved-attempt prompt branch.
- Leave `hasGenuineBlocker` and its baseline unchanged. After stripping reserved harness sections, a non-reserved agent `## Blocker` still settles `plan.draft.blocker`, including when it was adjacent to a stripped harness section.

## Tasks

- Add plan-draft attempt preparation that classifies, removes, and collects reserved harness blocker sections from preserved staged `intent.md` before prompt selection and blocker-contract setup.
- Extend both preserved-attempt prompt renderers with the canonical ordered diagnostic section and keep fresh-draft prompts unchanged.
- Add the execution, real failure-chain, lint-reprompt, and prompt-rendering regressions below. Put each required `// @mutate` directive inside its named test body, use a unique source anchor, and prove the scoped test turns red.
- Update the durable behavior docs listed below.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` test `plan redraft clears normalizer blockers and forwards canonical diagnostics` drives two actual normalizer rejections that append markers, preserves the stage, then drives a valid redraft. It fails against the pre-fix pass-through and asserts completion rather than `plan.draft.blocker`, no reserved blocker remains in staged `intent.md`, and every appended normalizer reason reaches the invocation in append order. `v2/src/execution/write-loop.test.ts` — `plan redraft clears normalizer blockers and forwards canonical diagnostics`; Keystone checkpoint:
- [x] `v2/src/execution/write.test.ts` test `plan redraft recognizes only reserved harness blocker sections` pins exact level-two heading recognition and that marker-prefix matching alone removes a section while non-matching headings and bodies remain. Its body has distinct linked `// @mutate` directives that invert the heading-recognition and marker-prefix guards. `v2/src/execution/write.test.ts` — `plan redraft recognizes only reserved harness blocker sections`; Mutation checkpoint:
- [x] `v2/src/execution/write.test.ts` test `plan redraft removes complete harness blocker sections without disturbing agent content` pins removal of each matching heading and body, preserving surrounding intent bytes and non-reserved blocker sections in order. Its body has a linked `// @mutate` directive that disables section removal. `v2/src/execution/write.test.ts` — `plan redraft removes complete harness blocker sections without disturbing agent content`; Mutation checkpoint:
- [x] `shared/prompts/plan-draft.test.ts` test `renders canonical ordered harness diagnostics only when supplied` pins payload trimming, interior multiline whitespace, an empty payload data zone, exact record delimiters, source order, and omission on a fresh draft. Its body has a linked `// @mutate` directive that drops the collected diagnostics before rendering. `shared/prompts/plan-draft.test.ts` — `renders canonical ordered harness diagnostics only when supplied`; Mutation checkpoint:
- [x] `v2/src/execution/write.test.ts` test `plan lint reprompt forwards canonical harness diagnostics` starts from a preserved stage, selects `write.staged-markdown-lint-reprompt`, and receives the same ordered canonical diagnostic section after clearing. Its body has a linked `// @mutate` directive that prevents diagnostic forwarding on the lint-reprompt branch. `v2/src/execution/write.test.ts` — `plan lint reprompt forwards canonical harness diagnostics`; Mutation checkpoint:
- [x] `v2/src/execution/write.test.ts` test `plan redraft preserves a non-reserved agent blocker beside harness diagnostics` starts with both kinds and asserts the reserved section is cleared and forwarded while the non-reserved agent section remains and settles `contract_miss` with `failedContractId` and `failureReason` equal to `plan.draft.blocker`. Its body has a linked `// @mutate` directive that clears the non-reserved section. `v2/src/execution/write.test.ts` — `plan redraft preserves a non-reserved agent blocker beside harness diagnostics`; Mutation checkpoint:
- [x] `v2/src/execution/write.test.ts` test `plan redraft diagnostics are one-shot after invocation failure` pins the documented lifetime: a failed invocation leaves the cleaned stage but does not replay its cleared diagnostics on the next attempt.
- [x] `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` document the reserved marker, canonical payload and delimiter representation, both prompt branches, one-shot lifetime, and unchanged mixed-blocker evaluation.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — canonically document plan-draft reserved harness-marker clearing, prompt representation and lifetime, and unchanged genuine-blocker evaluation.
- `v2/docs/v1-behaviors.md` — align the v2 plan-draft normalizer rejection diagnostics entry with cleared staging, both redraft prompt branches, one-shot lifetime, and mixed-blocker behavior.
