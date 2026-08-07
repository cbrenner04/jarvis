# Verdict: required refinements

The spec’s diagnosis and fix direction are sound. Before merge, address the following gaps so acceptance criteria are satisfiable, refactor work is guarded, and verification matches repo gates.

## Required refinements

1. **Shared helper contract must not claim equivalence with `parseAcceptanceCriteria`.** The two parsers stop at different bullet shapes (checkbox vs plain `- `). The spec must state that the exported helper uses the same walker *shape* (marker line + continuations until next bullet or `##`) but takes an explicit bullet-start predicate and documents trim policy for continuation lines. The task checklist must reflect parameterized extraction, not “same rule” or “without behavior change” alone.

2. **Prerequisite block boundaries need one explicit decision.** Pin that only a `- ` at line start (no leading whitespace) begins a new prerequisite block; indented `- ` and alternate list markers are continuation text inside the current block, not new prerequisites. Blank lines inside a block follow the same inclusion rule as acceptance-criteria assembly.

3. **Mutation checkpoint AC must be harness-satisfiable.** The current criterion (revert multi-line `.split(...).every(...)` via `@mutate`) cannot meet spec-guidance rules (single-line directive, unique anchor). Rewrite the AC so the pinning test carries a one-line `@mutate` against a stable post-refactor anchor (e.g., the assembler call or a single guard line) that turns `accepts prerequisites bullet wrapped across two lines` red when block assembly is neutered. Drop prose that names the pre-fix multi-line expression as the machine contract.

4. **Add a preservation acceptance criterion for the `parseAcceptanceCriteria` refactor.** Extracting a shared helper changes two call sites; the spec must cite an existing pinning test in `shared/spec-parser.test.ts` (refactor AC pattern: “stays green” or named test) so behavior-preserving extraction is verifiable, not only asserted in the task checklist.

5. **Verification AC must match `shared/**` gate.** Add `bun run test:integration:v2` to the final verification criterion (or an equivalent statement that the ready gate runs it for this surface). Current ACs omit integration despite repo convention for `shared/**` changes.

6. **Prose-regression AC must align with the test.** The criterion requires refusal with `must list prerequisites as one bullet per line`, but `rejects malformed frontmatter and prerequisite prose` only asserts failure, not the message. Extend the task checklist and/or that test’s prerequisites-prose case to assert the exact error substring so the AC is honestly tickable.

7. **Pin the mid-inline-code fixture in the task checklist.** “Splits mid-inline-code” is ambiguous (break inside a span vs between spans). Specify the intended bytes for the three-or-more-line test so implementer and reviewer share one fixture.

## Recommended wording improvements (non-blocking but should land with refinements)

8. **Soften the prompt decision.** Change “rules out asking agents or prompts to avoid wrapping” to “does not change prompt authoring guidance in this slice” so the decision does not imply prompt/validation alignment.

9. **Broaden documentation scope slightly.** Beyond the v1 prerequisite baseline (~line 260), add a short v2 landing cross-reference that prerequisite validation accepts markdown continuations within a block-assembled bullet. Optionally note in docs that the legacy error string still says “one bullet per line” while behavior accepts logical bullets.

## Rationale

Items 1–7 block honest completion: overstated equivalence risks wrong implementation; underspecified boundaries and fixtures invite incompatible interpretations; the mutation AC is likely unsatisfiable under harness rules; missing preservation and integration ACs violate spec-guidance and AGENTS.md gates; the prose AC overclaims what the test asserts. Items 8–9 reduce operator confusion but do not block implementability.

## No split required

Single subspec remains appropriate: shared helper extraction and `validPrerequisites` consumption are one seam. The gap is missing AC coverage on the extractor side, not subspec size.

## Defended as-is (no refinement required)

- Out of scope for other line-by-line landing readers and dead v1 duplicate validation.
- No separate end-to-end landing happy-path AC (unit gate on `validateIntentStageContent` is the contract).
- No requirement for multi-bullet wrap scenarios or prompt copy changes in this slice.