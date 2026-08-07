# Multiline pin titles and extension-tolerant pinning

## Problem

Two pin-resolution brittleness modes strand correct implementations at `contract_miss` — linking a well-placed `// @mutate` to its criterion, not the code under test.

1. **Multiline `test.each([...])("title", …)`** — `enclosingPinTitle` matches `PIN_TITLE_PATTERN` on single lines only. In multiline `test.each`, the keyword is on one line and the title on a later `])("title", …)` line, so `pinTitle` never resolves and the checkpoint goes `hollow`.
2. **Test-file extension mismatch (`.test.tsx` vs `.test.ts`)** — a criterion naming `foo.test.tsx` when the file is `foo.test.ts` makes `resolvePinningTestPath` fail with `unresolved_pinning_test` even though the test and directive are correct.

Plan-draft hollow-pin guards (#2655 criterion naming, missing pinning file on disk) stay deferred — verifier-only scope.

## Decision ledger

- `enclosingPinTitle` resolves pin titles when the title literal sits on a continuation line of `test.each`/`describe.each`/`test`/`it`, not only the keyword line — rules out `hollow` on correct directives inside multiline test constructs; rules out leaving line-only backward scan as the sole strategy.
- Forward continuation title scan runs after the adjacent-line forward check and before the backward scan — rules out skipping multiline titles when the next line is not a declaration.
- Pinning-test basename resolution tolerates extension mismatch among `.ts`/`.tsx`/`.js`/`.jsx` when the stem is otherwise unique — rules out `unresolved_pinning_test` on a `.tsx`↔`.ts` slip; rules out requiring operators to hand-fix criterion extensions when basename search would have found the file.
- Extension tolerance applies to bare basename search only; path-qualified references do not fall back to alternate extensions — rules out guessing past an author-supplied path with wrong extension.
- Deferred to first consumer: plan-draft flags a criterion's named pinning test file missing on disk — pin when a caller needs it; rules out baking verifier tolerance and plan-draft existence checks in one spec without a scope pick.
- Deferred to first consumer: plan-draft asserts every mutation-checkpoint criterion names an enclosing `test()`/`it()` title resolvable in the referenced pinning file — pin when a caller needs it; rules out shipping plan-draft validation in the same spec as verifier fixes without an explicit scope decision.

## Prerequisites

- The mutation-checkpoint verifier selects ticked non-human criteria, parses `// @mutate` directives from pinning tests, links directives to criteria only when criterion text contains the directive pin title, and runs scoped verification (`v2/src/execution/mutation-checkpoint-verifier.ts`, `shared/mutation-checkpoint-criteria.ts`).
- Pinning-test resolution accepts a repo-relative path or a unique basename match under the worktree root (`resolvePinningTestPath`).

## Tasks

- Extend `enclosingPinTitle` in `v2/src/execution/mutation-checkpoint-verifier.ts`: after the adjacent-line forward check, scan forward for continuation-line title literals (multiline `test.each`/`describe.each` `])("title", …)` and similar); keep backward scan as fallback.
- Extend `resolvePinningTestPath`: when bare basename search finds zero matches, retry basename with alternate `.ts`/`.tsx`/`.js`/`.jsx` extensions when the stem is otherwise unique; leave path-qualified resolution unchanged.
- Add `mutation-checkpoint-verifier.test.ts` regressions for multiline `test.each` pin linking and extension-mismatch basename resolution, each with a mutation-checkpoint guard inversion on the real verifier code.
- Update `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — multiline-`test.each` titles are resolvable; criterion test-file basename should match on-disk extension when stem is not unique; criterion must still name the enclosing `test()` title.
- Update `v2/docs/operator-runbook.md` § Gate trust — hollow-on-multiline-`test.each` and `unresolved_pinning_test`-on-extension-mismatch failure modes and hand-fix when tolerance does not apply.
- Update `v2/docs/v1-behaviors.md` — mutation-checkpoint pin-title and pinning-test resolution bullets reflect multiline title support and extension-tolerant basename lookup.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `multiline test.each continuation title links directive` proves a `// @mutate` inside multiline `test.each([...])("<title>", …)` resolves `pinTitle` to `<title>` and links to a criterion naming `<title>` (reaches `caught`, not `hollow`); fails against the current line-based `enclosingPinTitle`.
- [ ] `mutation-checkpoint-verifier.test.ts` — `pinning test extension mismatch resolves` proves pin resolution links a criterion naming `foo.test.tsx` to an on-disk `foo.test.ts` (reaches `caught`, not `unresolved_pinning_test`); fails pre-fix.
- [ ] `mutation-checkpoint-verifier.test.ts` — `multiline test.each continuation title links directive`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` `"for (let i = lineIndex + 1; i < lines.length; i += 1)" -> "for (let i = lines.length; i < lines.length; i += 1)"` inverting forward continuation title scan in `enclosingPinTitle`; the mutation turns the named pin RED.
- [ ] `mutation-checkpoint-verifier.test.ts` — `pinning test extension mismatch resolves`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` `"for (const altExt of [\".ts\", \".tsx\", \".js\", \".jsx\"])" -> "for (const altExt of [])"` inverting extension-tolerant basename lookup in `resolvePinningTestPath`; the mutation turns the named pin RED.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria documents multiline-`test.each` title resolvability, basename extension match when stem is not unique, and that criteria must still name the enclosing `test()` title.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents hollow-on-multiline-`test.each` and `unresolved_pinning_test`-on-extension-mismatch failure modes and hand-fix when tolerance does not apply.
- [ ] `v2/docs/v1-behaviors.md` records multiline continuation pin-title resolution and extension-tolerant basename lookup for mutation-checkpoint pinning.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — multiline-`test.each` titles; basename extension when stem is not unique; enclosing `test()` title still required.
- `v2/docs/operator-runbook.md` § Gate trust — multiline-`test.each` hollow and extension-mismatch `unresolved_pinning_test` triage.
- `v2/docs/v1-behaviors.md` — pin-title and pinning-test resolution bullets.
