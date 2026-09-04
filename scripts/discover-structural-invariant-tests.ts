import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type DiscoveryRule = "source-read" | "registry-mirror" | "structural-name";
export type DiscoveryScope = "in-scope" | "out-of-scope";
export type DiscoveryRationale = DiscoveryRule | "no-structural-signal";

export type DiscoveryManifestRow = {
  "test-path": string;
  scope: DiscoveryScope;
  rule: DiscoveryRationale;
};

const SCAN_ROOTS = ["v2/src", "shared"] as const;
const STRUCTURAL_NAME_PATTERN = /(?:^|[-.])(?:inventory|structure|guard|boundary|parity)(?:\.|[-_]|$)/i;
// Substring tokens, not anchored suffixes: a mirror named `..._BASELINES` or `..._BODY_LENGTH`
// is the same defect as one named `..._BASELINE`, and anchoring on the exact ending is itself the
// incidental-structure keying this audit exists to catalog.
const REGISTRY_MIRROR_NAME =
  /PERMITTED|FORBIDDEN|ALLOWED|LOSSLESS|CONSUMER|EXTRACTED_FROM|INVENTORY|REGISTRY|SURFACES|BASELINE|EXPECTED|_FILES|_MAP|_TITLES|_CALLERS|_LENGTH|_BUCKETS/i;
const FIXTURE_PATH_HINT = /(?:fixtures?\/|\.scratch\/|manifest\.json|mkdtemp|tmpdir)/i;

export function walkCoLocatedTestFiles(repoRoot: string): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const absoluteRoot = join(repoRoot, root);
    for (const entry of readdirSync(absoluteRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".test.ts")) continue;
      files.push(relative(repoRoot, join(entry.parentPath, entry.name)).replace(/\\/g, "/"));
    }
  }
  return files.sort();
}

function matchesStructuralName(testPath: string): boolean {
  const base = testPath.split("/").pop() ?? testPath;
  return STRUCTURAL_NAME_PATTERN.test(base);
}

// A read whose path is computed into a variable (`readFileSync(sourcePath, "utf8")`) carries no
// literal path to match, which is the ordinary style — requiring a literal production hint inside
// the call text silently drops most real source-reading tests. Fixture and temp-dir reads are
// excluded positively; everything else counts. Over-inclusion is dispositioned at inventory time,
// where it is visible; a false negative is invisible.
function readCallLooksProduction(readCall: string): boolean {
  return !FIXTURE_PATH_HINT.test(readCall);
}

function matchesSourceRead(source: string): boolean {
  if (/\bmerge-base\b/.test(source)) return true;
  if (/\bgit\s+show\b/.test(source) || /["']show["']/.test(source)) return true;
  for (const match of source.matchAll(/\breadFile(?:Sync)?\s*\([^)]*\)/g)) {
    if (readCallLooksProduction(match[0])) return true;
  }
  return false;
}

function matchesRegistryMirror(source: string): boolean {
  for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*[\[{]/g)) {
    if (REGISTRY_MIRROR_NAME.test(match[1] ?? "")) return true;
  }
  return false;
}

function matchedRules(testPath: string, source: string): DiscoveryRule[] {
  const rules: DiscoveryRule[] = [];
  if (matchesSourceRead(source)) rules.push("source-read");
  if (matchesRegistryMirror(source)) rules.push("registry-mirror");
  if (matchesStructuralName(testPath)) rules.push("structural-name");
  return rules;
}

function primaryRule(rules: readonly DiscoveryRule[]): DiscoveryRule {
  if (rules.includes("source-read")) return "source-read";
  if (rules.includes("registry-mirror")) return "registry-mirror";
  return "structural-name";
}

export function classifyStructuralInvariantTestFile(testPath: string, source: string): DiscoveryManifestRow {
  const rules = matchedRules(testPath, source);
  if (rules.length === 0) {
    return { "test-path": testPath, scope: "out-of-scope", rule: "no-structural-signal" };
  }
  return { "test-path": testPath, scope: "in-scope", rule: primaryRule(rules) };
}

export function discoverStructuralInvariantTests(repoRoot: string): DiscoveryManifestRow[] {
  return walkCoLocatedTestFiles(repoRoot).map((testPath) =>
    classifyStructuralInvariantTestFile(testPath, readFileSync(join(repoRoot, testPath), "utf8")),
  );
}

export function formatDiscoveryManifest(rows: readonly DiscoveryManifestRow[]): string {
  const lines = ["test-path\tscope\trule", ...rows.map((row) => `${row["test-path"]}\t${row.scope}\t${row.rule}`)];
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  process.stdout.write(formatDiscoveryManifest(discoverStructuralInvariantTests(process.cwd())));
}
