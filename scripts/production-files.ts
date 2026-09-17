import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type SourceFile = { file: string; source: string };

export const TEST_SUPPORT_SUFFIX = ".test-support.ts";
const PRODUCTION_ROOTS = ["v2/", "shared/"] as const;
const TEST_HARNESS_ROOT = "v2/src/testing/";

/** True when the basename is test code: `*.test.ts`, `*.test.tsx`, or `*.test-support.ts`. */
export function isTestCodePath(path: string): boolean {
  const basename = path.split("/").at(-1) ?? path;
  return /\.test\.tsx?$/.test(basename) || basename.endsWith(TEST_SUPPORT_SUFFIX);
}

/** True for a shippable module: under v2/ or shared/, a .ts/.tsx source, not a test, test-support, or v2/src/testing harness file. */
export function isProductionSourceFile(file: string): boolean {
  return (
    PRODUCTION_ROOTS.some((root) => file.startsWith(root)) &&
    /\.tsx?$/.test(file) &&
    !isTestCodePath(file) &&
    !file.startsWith(TEST_HARNESS_ROOT)
  );
}

export function isTestSupportImport(specifier: string): boolean {
  return specifier.endsWith(TEST_SUPPORT_SUFFIX) || specifier.endsWith(".test-support");
}

export function collectSourceFiles(root: string, cwd: string): SourceFile[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path, cwd);
    const file = relative(cwd, path);
    return entry.isFile() && /\.tsx?$/.test(file) ? [{ file, source: readFileSync(path, "utf8") }] : [];
  });
}

/** Every production source file under the v2 and shared roots of `cwd`. */
export function collectProductionSourceFiles(cwd: string): SourceFile[] {
  return [...collectSourceFiles(join(cwd, "v2"), cwd), ...collectSourceFiles(join(cwd, "shared"), cwd)].filter(
    ({ file }) => isProductionSourceFile(file),
  );
}
