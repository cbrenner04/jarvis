/**
 * Scoped-test list shapes. Both are `string[]` at runtime; the brands make passing a coverage
 * pattern list where killing-test paths are expected (or vice versa) a compile-time error.
 */
declare const coverageScopeBrand: unique symbol;
declare const killingTestPathsBrand: unique symbol;

/** Test file patterns handed to one `bun test --coverage` invocation. */
export type CoverageTestScope = readonly string[] & { readonly [coverageScopeBrand]: true };
/** Resolved killing-test file paths, each run as its own `bun test <path>`. */
export type KillingTestPaths = readonly string[] & { readonly [killingTestPathsBrand]: true };

export function coverageTestScope(patterns: readonly string[]): CoverageTestScope {
  return patterns as CoverageTestScope;
}

export function killingTestPaths(paths: readonly string[]): KillingTestPaths {
  return paths as KillingTestPaths;
}
