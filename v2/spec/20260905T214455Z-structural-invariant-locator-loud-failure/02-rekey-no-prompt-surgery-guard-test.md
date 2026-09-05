# Re-key shared/prompts/no-prompt-surgery-guard.test.ts

## Problem

Rows `shr-npsg-assembly-paths` and `shr-npsg-forbidden-tokens` anchor the guard to hand-maintained path and token literals instead of the assembly and policy surfaces they protect.

## Decision ledger

- `shr-npsg-assembly-paths` discovers guarded assembly sources from a committed registry or export surface, not a hand-maintained `GUARDED_ASSEMBLY_PATHS` list; rules out a test-local path array as the source of truth.
- `shr-npsg-forbidden-tokens` imports forbidden construct tokens from a shared policy constant consumed by the guard helper, not a test-local literal list; rules out duplicating token strings only in the test file.
- Missing assembly files fail through the shared guard helper with an explicit violation, routed via loud-failure discovery where paths are resolved; rules out silent skip when a listed path is absent from the read map.

## Task checklist

- [x] Re-key audit rows `shr-npsg-assembly-paths` and `shr-npsg-forbidden-tokens` per the decision ledger.
- [x] Route path resolution through `shared/structural-test-locator.ts` where discovery reads production sources.

## Acceptance criteria

- [x] `shared/prompts/no-prompt-surgery-guard.test.ts` test `prompt assembly builders omit post-render string surgery` derives guarded assembly paths from a committed source-of-truth registry rather than a hand-maintained test list; it fails against the pre-fix `GUARDED_ASSEMBLY_PATHS` list and passes after re-key.
- [x] `shared/prompts/no-prompt-surgery-guard.test.ts` test `prompt surgery guard reports forbidden constructs` reads forbidden tokens from the same shared policy constant as production scanning; it fails against the pre-fix test-local `FORBIDDEN_PROMPT_SURGERY_TOKENS` literal and passes after re-key.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.
- [x] `bun run test:integration:shared` passes.

## Documentation updates

None — locator contract is pinned by tests and adopted by later surface intents.
