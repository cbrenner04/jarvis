---
name: mutation-checkpoint-pin-resolution
---

# Mutation-checkpoint pin resolution for multiline tests and test-file extensions

Splitting does not apply: multiline pin-title resolution and pinning-test extension tolerance both land on the execution-loop mutation-checkpoint verifier seam (verifier-only; plan-draft hollow-pin guards deferred).

## Problem

Two independent pin-resolution brittleness modes stranded correct implementations at `contract_miss`. Both concern linking a well-placed `// @mutate` directive to its criterion, not the code under test.

1. **Multiline `test.each([...])("title", …)`** — `enclosingPinTitle` scans single lines for `PIN_TITLE_PATTERN`. In multiline `test.each`, the keyword is on one line and the title on a later `])("title", …)` line, so pin title never resolves and the checkpoint goes `hollow` despite a correct directive.
2. **Test-file extension mismatch (`.test.tsx` vs `.test.ts`)** — a criterion naming `foo.test.tsx` when the file is `foo.test.ts` makes `resolvePinningTestPath` fail with `unresolved_pinning_test` even though the test and directive are correct.

Related authoring gap: the must-name-enclosing-test rule (#2655) is guidance and plan-review advisory only; plan-draft does not validate it, so criteria omitting the pin title still land and go hollow at implement time.

## Decisions

- `enclosingPinTitle` resolves pin titles when the title literal sits on a continuation line of `test.each`/`describe.each`/`test`/`it`, not only the keyword line — rules out `hollow` on correct directives inside multiline test constructs; rules out leaving line-only backward scan as the sole strategy.
- Pinning-test resolution tolerates a test-file extension mismatch among `.ts`/`.tsx`/`.js`/`.jsx` when the stem is otherwise unique — rules out `unresolved_pinning_test` on a `.tsx`↔`.ts` slip; rules out requiring operators to hand-fix criterion extensions when basename search would have found the file.
- Deferred to first consumer: plan-draft flags a criterion's named pinning test file missing on disk instead of verifier extension tolerance — pin when a caller needs it; rules out baking both verifier tolerance and plan-draft existence checks without a scope pick.
- Deferred to first consumer: plan-draft asserts every mutation-checkpoint criterion names an enclosing `test()`/`it()` title resolvable in the referenced pinning file — pin when a caller needs it; rules out shipping plan-draft validation in the same spec as verifier fixes without an explicit scope decision (extends #2655 from guidance to a hard gate).

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `multiline test.each continuation title links directive` proves a `// @mutate` inside multiline `test.each([...])("<title>", …)` resolves `pinTitle` to `<title>` and links to a criterion naming `<title>` (reaches `caught`, not `hollow`); fails against the current line-based `enclosingPinTitle`.
- [ ] `mutation-checkpoint-verifier.test.ts` — `pinning test extension mismatch resolves` proves pin resolution links a criterion naming `foo.test.tsx` to an on-disk `foo.test.ts` (reaches `caught`, not `unresolved_pinning_test`); fails pre-fix.
- [ ] `mutation-checkpoint-verifier.test.ts` — `multiline test.each continuation title links directive`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` `"for (let i = lineIndex + 1; i < lines.length; i += 1)" -> "for (let i = lines.length; i < lines.length; i += 1)"` inverting forward continuation title scan in `enclosingPinTitle`; the mutation turns the named pin RED.
- [ ] `mutation-checkpoint-verifier.test.ts` — `pinning test extension mismatch resolves`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` `"for (const altExt of [\".ts\", \".tsx\", \".js\", \".jsx\"])" -> "for (const altExt of [])"` inverting extension-tolerant basename lookup in `resolvePinningTestPath`; the mutation turns the named pin RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — multiline-`test.each` titles are resolvable; criterion test-file basename should match on-disk extension when stem is not unique; criterion must still name the enclosing `test()` title.
- `v2/docs/operator-runbook.md` § Gate trust — hollow-on-multiline-`test.each` and `unresolved_pinning_test`-on-extension-mismatch failure modes and hand-fix.
- `v2/docs/v1-behaviors.md` — mutation-checkpoint pin-title and pinning-test resolution bullets reflect multiline title support and extension-tolerant basename lookup.

## Prerequisites

- The mutation-checkpoint verifier selects ticked non-human criteria, parses `// @mutate` directives from pinning tests, links directives to criteria only when criterion text contains the directive pin title, and runs scoped verification.
- Pinning-test resolution accepts a repo-relative path or a unique basename match under the worktree root.
