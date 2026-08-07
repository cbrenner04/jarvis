---
name: mutation-checkpoint-pin-resolution-is-brittle
---

# Mutation-checkpoint pin resolution fails on multiline `test.each` titles and on test-file extension mismatches, stranding correct implementations

## Problem

Two independent pin-resolution brittleness modes each stranded a correct implementation at `contract_miss` this session. Both are about the verifier's ability to link a well-placed, correct `// @mutate` directive to its criterion — not about the code under test.

1. **Multiline `test.each([...])("title", …)`** — `enclosingPinTitle` (`v2/src/execution/mutation-checkpoint-verifier.ts`) scans backward line-by-line for `PIN_TITLE_PATTERN`. In a multiline `test.each`, the `test`/`it` keyword is on the `test.each([` line and the title string is on a later `])("title", …)` line, so no single line carries both — the pin title never resolves and the checkpoint is reported `hollow` ("no @mutate directive linked to this criterion"), even though the directive sits correctly inside the block.
2. **Test-file extension mismatch (`.test.tsx` vs `.test.ts`)** — the plan authored a criterion naming the pinning test `tui-monitor-lines.test.tsx`, but the file is `tui-monitor-lines.test.ts`. `resolvePinningTestPath` matches by basename and fails (`unresolved_pinning_test`), stranding the implement even though the test + directive are correct.

Related authoring gap: the mutation-checkpoint-criterion-must-name-enclosing-test rule (#2655) is guidance only; plan-draft does not validate it, so a criterion that omits the enclosing `test()` title still lands and goes hollow.

## Evidence

- 2026-08-07: `tui-dock-pipeline-steering` subspec 00 — directive inside `test.each([...])("classifies unavailable %s", …)`; settled `contract_miss` / hollow. Correct parser code, correct directive placement.
- 2026-08-07: `tui-remove-waitstate-window-detail` — criterion said `tui-monitor-lines.test.tsx`; file is `.test.ts`; settled `contract_miss` / `unresolved_pinning_test`. Operator corrected the extension and hand-published.

## Decisions

- `enclosingPinTitle` resolves the title for a multiline `test.each`/`describe.each`/`test`/`it` where the title literal is on a continuation line, not only the keyword line — rules out hollow-on-correct-directive inside multiline test constructs. (Scan forward/backward for the nearest title literal associated with the enclosing test block, or parse the block rather than a single line.)
- Pin-test resolution tolerates a test-file extension mismatch among the known test extensions (`.ts`/`.tsx`/`.js`/`.jsx`) when the stem is otherwise unique — or plan-draft validates that a criterion's named pinning test file exists on the worktree before landing — rules out `unresolved_pinning_test` on a `.tsx`↔`.ts` slip.
- Consider a plan-draft assertion that every mutation-checkpoint criterion names an enclosing `test()`/`it()` title that resolves in the referenced file — rules out shipping a criterion that will go hollow at implement time (extends #2655 from guidance to a check). Pick the scope at plan time.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — a `// @mutate` directive inside a multiline `test.each([...])("<title>", …)` block resolves to `<title>` and links to a criterion naming `<title>` (reaches `caught`, not `hollow`); fails against the current line-based `enclosingPinTitle`.
- [ ] Pin resolution links a criterion naming `foo.test.tsx` to an on-disk `foo.test.ts` (or plan-draft flags the mismatch); a regression covers the `.tsx`↔`.ts` case and fails pre-fix.
- [ ] Mutation checkpoint: in the multiline-`test.each` regression, a `// @mutate` directive inside that block inverting the new resolution turns it RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — note multiline-`test.each` titles are now resolvable and the exact test-file basename (with extension) should match; the criterion must still name the enclosing `test()` title.
- `v2/docs/operator-runbook.md` § Gate trust — hollow-on-multiline-`test.each` and `unresolved_pinning_test`-on-extension-mismatch failure modes and their hand-fix.
