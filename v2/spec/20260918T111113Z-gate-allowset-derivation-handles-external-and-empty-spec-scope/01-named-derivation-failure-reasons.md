# Named derivation-failure reasons

## Problem

`deriveGateAllowedPaths` (`v2/src/execution/ready-finalize.ts`) has eight `return undefined` failure branches (diff throw, diff null, untracked throw, untracked null, spec tree null, diff parse, untracked parse, path validation); callers cannot tell them apart.

## Decisions

- Return a discriminated result `{ ok: true; paths: Set<string> } | { ok: false; reason: <literal union> }`, one literal per branch; rules out a thrown error or a shared string.
- All `enumerateSpecTreePaths` failures surface as the single spec-tree reason; rules out a second reason taxonomy.
- Callers that directly invoke `deriveGateAllowedPaths` keep current fail-closed behavior on `ok: false` (treat it the same as today's `undefined`): `write-loop.ts`'s `initializeFrozenRepairAllowset` (`v2/src/execution/write-loop.ts:3459`) and `enumerateAutofixChangedPaths` (`v2/src/execution/write-loop.ts:3872`), and `classifyReadyGateError` (`v2/src/execution/ready-finalize.ts:905`). `classifyReadyGateFailure` is unaffected — it already takes `allowedPaths: Set<string> | undefined` as a parameter and treats `undefined` as fail-closed (`v2/src/execution/ready-finalize.ts:707`); rules out changing gate classification here.
- Deferred to first consumer: rendering the reason in run logs or operator surfaces — pin when a caller needs it.

## Tasks

- [ ] Define the reason union and result type; convert all eight branches.
- [ ] Migrate `write-loop.ts:3459`, `write-loop.ts:3872`, and `classifyReadyGateError` (`ready-finalize.ts:905`) to unwrap the result shape and existing tests to match.
- [ ] Add a table-driven test over all eight branches via seams.

## Acceptance criteria

- [ ] A `ready-finalize.test.ts` table test drives each of the eight failure branches and asserts each returns its own distinct `reason`; it fails against the pre-fix bare `undefined` return.
- [ ] `v2/src/execution/write-loop.test.ts`'s `"ready-gate repair fence"` tests (covering `initializeFrozenRepairAllowset`'s `deriveGateAllowedPaths` call at `v2/src/execution/write-loop.ts:3459`, e.g. `"completes repair limited to the resolved spec tree"`, `"rejects ready-gate repairs outside the run diff and spec tree"`) and `"ready-gate repair autofix"` tests (covering `enumerateAutofixChangedPaths`'s call at `v2/src/execution/write-loop.ts:3872`, e.g. `"ready-gate repair autofix rejects out-of-scope formatter changes"`, `"ready-gate repair autofix scopes biome argv to changed paths"`) stay green after migrating both call sites to the result shape.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — note that each `deriveGateAllowedPaths` failure branch returns its own named reason instead of a shared `undefined`; the reason strings themselves are deferred to the first consumer that renders them.
