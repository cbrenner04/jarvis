# Multiline pin titles and extension-tolerant pinning

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Two pin-resolution brittleness modes strand correct implementations at `contract_miss` — linking a well-placed `// @mutate` to its criterion, not the code under test.

1. **Multiline `test.each([...])("title", …)`** — main already attributes directives via adjacent-line forward pin resolution (`#2682`); the gap is continuation titles beyond the immediately adjacent line. In multiline `test.each`, the opener line has no on-line title and the title sits on a later `])("title", …)` line above the callback body. Backward walk from the directive finds the opener but never scans forward from it, so `pinTitle` stays unresolved and the checkpoint goes `hollow`.
2. **Test-file extension mismatch (`.test.tsx` vs `.test.ts`)** — a criterion naming `foo.test.tsx` when the file is `foo.test.ts` makes `resolvePinningTestPath` fail with `unresolved_pinning_test` even though the test and directive are correct.

Plan-draft hollow-pin guards (#2655 criterion naming, missing pinning file on disk) stay deferred — verifier-only scope.

## Decision ledger

- `enclosingPinTitle` keeps adjacent-line forward attribution (`#2682`); during backward walk from the directive, when a `test.each` opener line lacks an on-line title, scan forward from that opener for the continuation title (e.g. `])("title", …)` above the callback) — rules out `hollow` on correct directives inside multiline `test.each`; rules out scanning forward from the directive index instead of the opener; rules out leaving opener-anchored continuation scan out of the backward walk.
- Behavioral proof covers multiline `test.each` only; same opener-anchored forward scan may generalize to similar layouts but is not separately acceptance-tested here.
- Pinning-test basename resolution retries with alternate `.ts`/`.tsx`/`.js`/`.jsx` extensions only when the primary basename search finds zero matches and exactly one file matches across the primary name plus alternates — rules out `unresolved_pinning_test` on a unique `.tsx`↔`.ts` slip; rules out retry when the primary basename already matches one or more files; rules out retry when any alternate basename matches more than one file (same `unresolved_pinning_test` as ambiguous basename today).
- Extension tolerance applies to bare basename search only; path-qualified references do not fall back to alternate extensions — rules out guessing past an author-supplied path with wrong extension. `.mts`/`.cts` are outside the tolerance set.
- Deferred to first consumer: plan-draft flags a criterion's named pinning test file missing on disk — pin when a caller needs it; rules out baking verifier tolerance and plan-draft existence checks in one spec without a scope pick.
- Deferred to first consumer: plan-draft asserts every mutation-checkpoint criterion names an enclosing `test()`/`it()` title resolvable in the referenced pinning file — pin when a caller needs it; rules out shipping plan-draft validation in the same spec as verifier fixes without an explicit scope decision.

## Prerequisites

- The mutation-checkpoint verifier selects ticked non-human criteria, parses `// @mutate` directives from pinning tests, links directives to criteria only when criterion text contains the directive pin title, and runs scoped verification (`v2/src/execution/mutation-checkpoint-verifier.ts`, `shared/mutation-checkpoint-criteria.ts`).
- Pinning-test resolution accepts a repo-relative path or a unique basename match under the worktree root (`resolvePinningTestPath`).

## Tasks

- Extend `enclosingPinTitle` in `v2/src/execution/mutation-checkpoint-verifier.ts`: keep adjacent-line forward check; during backward walk from the directive, when a `test.each` opener lacks an on-line title, scan forward from that opener for continuation-line title literals; keep on-line and backward matches as fallbacks.
- Extend `resolvePinningTestPath`: when bare basename search finds zero matches, retry with alternate `.ts`/`.tsx`/`.js`/`.jsx` basenames; resolve only when exactly one file matches across primary plus alternates; leave path-qualified resolution unchanged.
- Add `mutation-checkpoint-verifier.test.ts` regressions for multiline `test.each` pin linking and extension-mismatch basename resolution, each with a mutation-checkpoint guard inversion on the real verifier code.
- Update `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — multiline-`test.each` continuation titles are resolvable; bare basename should match on-disk extension when stem is not unique or alternates collide; criterion must still name the enclosing `test()` title; `.mts`/`.cts` not in extension-tolerance set.
- Update `v2/docs/operator-runbook.md` § Gate trust — reconcile with existing adjacent-line-forward bullet (`#2682`); document hollow-on-multiline-`test.each` continuation-title gap and `unresolved_pinning_test`-on-extension-mismatch failure modes and hand-fix when tolerance does not apply (ambiguous basename, both `.ts` and `.tsx` present, path-qualified wrong extension).
- Update `v2/docs/v1-behaviors.md` — mutation-checkpoint pin-title and pinning-test resolution bullets reflect opener-anchored continuation title support for multiline `test.each` and extension-tolerant bare-basename lookup.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `multiline test.each continuation title links directive` proves a `// @mutate` inside multiline `test.each([...])("<title>", …)` resolves `pinTitle` to `<title>` and links to a criterion naming `<title>` (reaches `caught`, not `hollow`); fails against pre-fix continuation-title resolution in `enclosingPinTitle`.
- [ ] `mutation-checkpoint-verifier.test.ts` — `pinning test extension mismatch resolves` proves pin resolution links a criterion naming `foo.test.tsx` to an on-disk `foo.test.ts` (reaches `caught`, not `unresolved_pinning_test`); fails pre-fix.
- [ ] `mutation-checkpoint-verifier.test.ts` — `multiline test.each continuation title links directive`; Mutation checkpoint: its pinning test carries a `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` directive that inverts continuation-title resolution in `enclosingPinTitle` using a uniquely occurring anchor in landed code; the mutation turns the named pin RED.
- [ ] `mutation-checkpoint-verifier.test.ts` — `pinning test extension mismatch resolves`; Mutation checkpoint: its pinning test carries a `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` directive that inverts extension-tolerant basename lookup in `resolvePinningTestPath` using a uniquely occurring anchor in landed code; the mutation turns the named pin RED.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria documents multiline-`test.each` continuation-title resolvability, bare-basename extension match when stem is not unique or alternates collide, enclosing `test()` title still required, and `.mts`/`.cts` outside the tolerance set.
- [ ] `v2/docs/operator-runbook.md` § Gate trust reconciles with adjacent-line-forward behavior and documents hollow-on-multiline-`test.each` continuation-title and `unresolved_pinning_test`-on-extension-mismatch failure modes and hand-fix when tolerance does not apply.
- [ ] `v2/docs/v1-behaviors.md` records opener-anchored continuation pin-title resolution for multiline `test.each` and extension-tolerant bare-basename lookup for mutation-checkpoint pinning.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — multiline-`test.each` continuation titles; bare-basename extension when stem is not unique or alternates collide; enclosing `test()` title still required; `.mts`/`.cts` exclusion.
- `v2/docs/operator-runbook.md` § Gate trust — reconcile `#2682` adjacent-line-forward bullet; multiline-`test.each` continuation hollow and extension-mismatch `unresolved_pinning_test` triage.
- `v2/docs/v1-behaviors.md` — pin-title and pinning-test resolution bullets.
