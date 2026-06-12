# Biome Gate Violation Fixtures

This directory contains fixtures that demonstrate Biome gate violations. These files are excluded from the regular `bun run check` (listed in biome.json `files.includes`) but can be verified to prove the rules work.

## Fixtures

### complexity-violation.ts

A function with excessive cognitive complexity (exceeds the `noExcessiveCognitiveComplexity` threshold). This fixture proves the complexity gate catches over-nested or over-conditional code.

To verify it's caught, copy it out of the ignored directory:
```bash
cp v2/test/fixtures/complexity-violation.ts v2/src/temp-verify-complexity.ts
bun run check  # Should report complexity error
rm v2/src/temp-verify-complexity.ts
```

Expected: Error reporting `noExcessiveCognitiveComplexity` (complexity exceeds threshold).

### shared-import-violation.ts

A file importing from `v1/**` using a relative path (`../../v1/...`), which violates the shared-layer import boundary. The shared layer must not depend on version-specific code. Uses the relative-aware glob pattern (`**/v1/**`) to match real import specifiers in the codebase.

To verify it's caught:
```bash
cp v2/test/fixtures/shared-import-violation.ts shared/temp-verify-import.ts
bun run check  # Should report import boundary error
rm shared/temp-verify-import.ts
```

Expected: Error reporting `noRestrictedImports` at the v1 import statement.
