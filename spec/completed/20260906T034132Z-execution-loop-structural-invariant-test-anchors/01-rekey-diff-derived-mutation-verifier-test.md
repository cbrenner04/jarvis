# Re-key diff-derived-mutation-verifier.test.ts

## Problem

Rows `ex-ddmv-observer-map-source` and `ex-ddmv-render-coverage-needle` in `v2/docs/structural-invariant-test-audit.md` pin render-coverage to a module-scope `readFileSync` copy of `render-observer-tests.ts` and merge-base diff prose substring needles, so registry growth or prompt wording moves pass vacuously or fail unrelated verifier work.

## Decision ledger

- Render-observer coverage resolves through `resolveRenderObserverTests` / `extractRenderObserverMapFromSource`, not a test-local `PROCESS_RENDER_OBSERVER_MAP` source string; rules out copying the registry file into the test at module load.
- Render-coverage assertions schedule scoped tests from the resolved observer map keyed by changed prompt ids, not merge-base prose substring pins; rules out `The diff comes from git merge-base <base> HEAD.` as the coverage gate.
- Seam `readFile` helpers for observer map injection use the same resolver entrypoints the production verifier uses; rules out ad-hoc empty-map string stubs that bypass registry shape.

## Task checklist

- [x] Re-key audit rows `ex-ddmv-observer-map-source` and `ex-ddmv-render-coverage-needle` per the decision ledger.
- [x] Delete module-scope registry source mirroring; drive coverage cases through `resolveRenderObserverTests`.
- [x] Rewrite render-coverage scheduling assertions to key on resolved test paths per changed prompt.

## Acceptance criteria

- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` module scope resolves render-observer coverage through `resolveRenderObserverTests` / `extractRenderObserverMapFromSource` rather than a `readFileSync` copy of `render-observer-tests.ts`; it fails against the pre-fix `PROCESS_RENDER_OBSERVER_MAP` mirror and passes after re-key.
- [x] `diff-derived-mutation-verifier.test.ts` test `invokes only that prompt's render-observer test file(s) per changed prompt` asserts scoped invocation from the resolved observer map, not merge-base prose substring pins; it fails against the pre-fix prose needles and passes after re-key.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
