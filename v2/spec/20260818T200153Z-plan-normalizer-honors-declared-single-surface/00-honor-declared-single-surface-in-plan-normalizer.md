# Honor a declared single surface in the plan-draft normalizer

## Problem

`normalizePlanDraftSpecDir` (`shared/module-boundary-surfaces.ts`) re-derives scope by keyword regex over `## Acceptance criteria` bullets and never reads the staged `intent.md`, so it ignores the scope the intent split stage already declared and the operator already reviewed. A spec that merely names a second surface as an unchanged dependency classifies across two surfaces, is split, and hard-errors on the first bullet matching both. Observed on `pipeline-list-human-readable` (2026-08-16/17): five consecutive plan runs stranded with an artifact-contract blocker and the tree had to be hand-landed (PR #2877). A redraft cannot escape it — the vocabulary is correct, and the intent's own `## Decisions` re-introduce it.

## Decision ledger

- The declaration is read only from staged `intent.md`; declaration text in a subspec body never suppresses the split. Rules out a drafting agent opting its own subspec out with prose.
- Declaration grammar is the pair the split prompt emits: exactly one `Unsplit rationale:` line whose remaining text is non-empty, plus a `## Primary implementation surface` section whose body is exactly one non-blank line. Rules out heuristic parsing of free prose, and rules out inventing a section the producer does not write.
- A declared plan returns at the existing single-boundary early-return point in `normalizePlanDraftSpecDir` — after index-link validation and keystone satisfiability, before the multi-boundary detection. Rules out placing the skip above checks the declaration is not meant to disable.
- A declared plan therefore gets byte-identical handling to a plan whose criteria classify to one surface: no split, no multi-surface bullet hard-error, no out-of-union bullet check, and no renumbering. Rules out adding renumbering that the single-boundary path has never performed, which would rewrite staged filenames the operator reviewed.
- Absent `intent.md`, or absent either half of the declaration, behavior is byte-for-byte what it is today. Rules out hard-erroring on legacy, hand-authored, or durable-directory input that never declared scope.
- No separate change for the recovery revalidation path: `checkStagedPlanDraft` reuses this normalizer, so declared durable and staged trees skip identically. Rules out a second declaration reader on that path.
- Deferred to first consumer: reporting a declaration that disagrees with the keyword-classified union — pin when a diagnostic caller needs it. The skip itself is unconditional either way.

## Task checklist

- Add a declaration reader in `shared/module-boundary-surfaces.ts` that parses staged `intent.md` for the grammar pair, returning false when the file is unreadable or either half is missing or malformed.
- Call it in `normalizePlanDraftSpecDir` on one physical line immediately before the multi-boundary early return, so both `@mutate` anchors quote unique single-line text.
- Cover the declared, undeclared, half-missing, subspec-body-only, unlinked-index-entry, and unsatisfiable-keystone cases in `shared/module-boundary-surfaces.test.ts`.
- Update `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `shared/module-boundary-surfaces.test.ts` test `a declared single-surface staged plan normalizes without splitting` fails against the pre-fix normalizer, then proves a staged plan whose `intent.md` carries the declaration pair — and whose acceptance bullets classify across two surfaces, including one bullet matching both — normalizes without throwing, emits no additional subspec, and leaves every subspec file and `index.md` byte-for-byte unchanged.
- [ ] `shared/module-boundary-surfaces.test.ts` — `a declared single-surface staged plan normalizes without splitting`; Keystone checkpoint: an in-body `// @mutate` directive reverting the declaration branch in `shared/module-boundary-surfaces.ts` to baseline (never skipping) splits the same staged plan and hard-errors on its two-surface bullet, turning this test red.
- [ ] `shared/module-boundary-surfaces.test.ts` test `a staged plan missing either half of the declaration still splits` proves the same staged plan with `intent.md` absent, with the rationale line absent, with the rationale line present but empty after the colon, with the primary-surface section absent, and with that section naming two entries each splits or hard-errors exactly as it does today.
- [ ] `shared/module-boundary-surfaces.test.ts` — `a staged plan missing either half of the declaration still splits`; Mutation checkpoint: an in-body `// @mutate` directive weakening the grammar guard so either half alone satisfies the declaration turns this test red.
- [ ] `shared/module-boundary-surfaces.test.ts` test `a declaration only in a subspec body does not suppress the split` proves the declaration pair written into a subspec body, with `intent.md` carrying neither half, still splits.
- [ ] `shared/module-boundary-surfaces.test.ts` test `a declared staged plan still refuses a broken index link and an unsatisfiable keystone criterion` proves a plan carrying the declaration pair still throws for an index entry linking no staged file and for a prose-only keystone criterion.
- [ ] Existing `shared/module-boundary-surfaces.test.ts` coverage stays green — the `k2`, `k3`, and `k4` fixture trees, whose `intent.md` files carry no declaration, still split, renumber, and refuse identically.
- [ ] `v2/docs/write-behavior.md` records that a staged `intent.md` declaring one surface bypasses boundary splitting and its bullet hard-errors, that keyword classification applies only to undeclared plans, that index-link and keystone checks still run, and that the recovery revalidation path shares this behavior.
- [ ] `v2/docs/v1-behaviors.md` plan-draft normalizer entry records the declaration skip and its grammar, correcting the entry that describes classification as unconditional.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — draft output shape contract: declared single-surface intents bypass boundary splitting; keyword classification applies only to undeclared plans; index-link and keystone checks unaffected; shared with recovery revalidation.
- `v2/docs/v1-behaviors.md` — align the plan-draft normalizer entry with the declaration skip.

## Implementer notes

- Keep the declaration call site and the grammar guard each on one physical line so both directives quote unique text; a baseline revert of the form `-> "if (false) return;"` is enough for the keystone.
- Build the declared fixture from the existing `k2` tree: copy it, replace its `intent.md` with the declaration pair, and keep its two-surface acceptance bullet, so the pre-fix run reproduces the observed hard error.
- Assert byte equality the way `leaves a single-boundary staged tree unchanged` already does (snapshot the directory listing and file buffers before the call).
- Add no test-only inversion hooks; both directives must mutate the real normalizer lines.
