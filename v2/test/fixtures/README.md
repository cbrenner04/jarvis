# Biome Gate Violation Fixtures

This directory contains fixtures that demonstrate Biome gate violations. These files are excluded from the regular `bun run check` but can be verified out-of-band to prove the rules work.

## Fixtures

### complexity-violation.ts

A function with excessive cognitive complexity (exceeds the `noExcessiveCognitiveComplexity` threshold of 25). This fixture proves the complexity gate catches over-nested or over-conditional code.

To verify it's caught:
```bash
bun node_modules/@biomejs/biome/bin/biome lint v2/test/fixtures/complexity-violation.ts --skip=noRestrictedImports
```

Expected: Error reporting `noExcessiveCognitiveComplexity` at the function declaration.

### shared-import-violation.ts

A file importing from `v1/**`, which violates the shared-layer import boundary. The shared layer must not depend on version-specific code.

To verify it's caught:
```bash
bun node_modules/@biomejs/biome/bin/biome lint v2/test/fixtures/shared-import-violation.ts --skip=noExcessiveCognitiveComplexity
```

Expected: Error reporting `noRestrictedImports` at the v1 import statement.
