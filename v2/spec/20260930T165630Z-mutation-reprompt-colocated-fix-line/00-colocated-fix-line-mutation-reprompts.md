# Co-located fix line in mutation reprompts

## Problem

For `importer-discovery-cap-exceeded` and `missing-killing-test`, `write.surviving-mutation-reprompt` and `write.mutation-repair` tell the agent to fix co-located coverage without naming `<dir>/<stem>.test.ts` or stating that importer-only tests elsewhere do not satisfy the verifier.

## Decision ledger

- Render a per-kind fix line only when `SURVIVING_MUTATION` is `importer-discovery-cap-exceeded` or `missing-killing-test`; all other mutation strings leave the line empty — rules out changing reprompt copy for operator-flip `surviving-mutation` survivors.
- Derive the named path from `SOURCE_FILE` with the same exact-stem rule as `resolveCoLocatedKillingTest` in `diff-derived-mutation-verifier.ts` (`<dir>/<stem>.test.ts` beside the production file); export or share that helper for the write/repair render path — rules out a second stem derivation that diverges from verifier resolution.
- Inject the fix line via dedicated placeholder `MUTATION_COVERAGE_FIX_DETAIL` rendered into both `prompts/write/surviving-mutation-reprompt.md` and `prompts/write/mutation-repair.md`; wire the same builder from `write.ts` surviving reprompt and `write-loop.ts` `write.mutation-repair` placeholders — rules out template-only wording with no shared render seam.
- Fix-line copy names only the exact-stem co-located path (`<dir>/<stem>.test.ts`); reprompt prose must not imply sibling `stem-*.test.ts` or other verifier-accepted co-located patterns are invalid — rules out steering agents away from patterns the verifier still accepts beside the production file.
- Fix-line copy scopes steering to this failure/reprompt: direct-importer or other non-co-located tests did not satisfy **this** survivor; prefer the named exact-stem file — rules out global wording that qualifying importers within cap or runbook recovery never count.
- For `importer-discovery-cap-exceeded`, the fix line is additional exact-stem co-located steering alongside runbook cap recovery (reduce sprawl, qualifying importer, etc.), not a substitute — rules out reprompt copy that replaces cap-recovery guidance.
- When `resolveCoLocatedKillingTest` returns `null` for `SOURCE_FILE`, emit an empty fix line (no invented path) — rules out guessing a path for non-code or test paths; reachable on main for `missing-killing-test` before importer discovery when co-located resolution is null.

## Tasks

- Export `resolveCoLocatedKillingTest` from `diff-derived-mutation-verifier.ts` (or move it to a shared module both verifier and write path import) and add a small pure helper that maps `(mutation, sourceFile)` → fix-detail string per the ledger.
- Add `MUTATION_COVERAGE_FIX_DETAIL` to both mutation prompt frontmatter `placeholders` lists; insert the placeholder in each template body where operators read coverage guidance; bump `revision` on both prompts.
- Pass `MUTATION_COVERAGE_FIX_DETAIL` from surviving-mutation reprompt assembly (`write.ts`) and mutation-repair `promptPlaceholders` (`write-loop.ts`); include the key (empty string when not applicable) in every render path for those prompts, including the operator-flip preservation test fixture.
- Extend `v2/src/execution/write-prompt.test.ts` with focused render tests for both prompt ids, both structured mutation kinds, and null co-located resolution (see acceptance criteria); update `write.surviving-mutation-reprompt renders the mutation site, both remedies, and injected rules` to pass `MUTATION_COVERAGE_FIX_DETAIL: ""`.
- Update `v2/docs/write-behavior.md`, `v2/docs/prompts.md`, and `v2/docs/v1-behaviors.md` per documentation updates.

## Acceptance criteria

- [ ] `write-prompt.test.ts` asserts rendered `write.surviving-mutation-reprompt` and `write.mutation-repair` for `importer-discovery-cap-exceeded` with `SOURCE_FILE` `v2/src/execution/foo.ts` contain `v2/src/execution/foo.test.ts` and reprompt-scoped steering that non-co-located importer/direct-importer tests did not satisfy this failure (not a global verifier ban on qualifying importers); fails against the pre-fix templates.
- [ ] `write-prompt.test.ts` asserts the same exact-stem path and scoped non-co-located steering for `missing-killing-test` on both prompt ids; fails against the pre-fix templates.
- [ ] `write-prompt.test.ts` asserts `MUTATION_COVERAGE_FIX_DETAIL` renders empty on both prompt ids for `missing-killing-test` when `SOURCE_FILE` yields null from `resolveCoLocatedKillingTest` (constructible on main before importer discovery); fails against the pre-fix assembly.
- [ ] `write-prompt.test.ts` test `write.surviving-mutation-reprompt renders the mutation site, both remedies, and injected rules` stays green with `MUTATION_COVERAGE_FIX_DETAIL: ""` in its placeholder map (operator-flip `SURVIVING_MUTATION` copy unchanged).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — per-kind `MUTATION_COVERAGE_FIX_DETAIL` on `write.surviving-mutation-reprompt` and `write.mutation-repair` for `importer-discovery-cap-exceeded` and `missing-killing-test` (exact-stem path from `SOURCE_FILE`; scoped steering away from non-co-located fixes); for `importer-discovery-cap-exceeded`, state the line supplements cap/runbook recovery (cross-link operator runbook as needed).
- `v2/docs/prompts.md` — add `MUTATION_COVERAGE_FIX_DETAIL` to the placeholder contract for `write.surviving-mutation-reprompt` and `write.mutation-repair`.
- `v2/docs/v1-behaviors.md` — record the changed operator-facing reprompt/repair guidance for those two survivor kinds.
