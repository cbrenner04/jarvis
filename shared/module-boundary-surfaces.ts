import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CHECKBOX_BULLET_PATTERN = /^\s*-\s\[[ xX]\]\s+(.+)$/u;
const PLAIN_BULLET_PATTERN = /^\s*-\s+(?!\[[ xX]\])\s*(.*)$/u;
/** A repo-relative path (contains a slash) or a root-level file with a known source extension.
 * Requiring one or the other keeps ordinary dotted identifiers (`run.finishedAtMs`) and numeric
 * literals (`0.0038492`) from being counted as artifacts. */
const BACKTICKED_PATH_PATTERN =
  /`(?:([^`\s]*\/[^`\s]*\.[A-Za-z0-9]+)|([^`\s/]+\.(?:md|tsx?|jsx?|json|sh|ya?ml|toml|txt|swift)))`/gu;

function sectionBulletTexts(body: string, heading: string, bulletPattern: RegExp): string[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const bullets: string[] = [];
  for (let headingIndex = 0; headingIndex < lines.length; headingIndex += 1) {
    if (lines[headingIndex] !== heading) continue;
    const nextHeading = lines.findIndex((line, index) => index > headingIndex && /^##\s/u.test(line ?? ""));
    const contentEnd = nextHeading === -1 ? lines.length : nextHeading;
    for (let index = headingIndex + 1; index < contentEnd; index += 1) {
      const match = (lines[index] ?? "").match(bulletPattern);
      if (!match?.[1]) continue;
      const parts = [match[1]];
      while (index + 1 < contentEnd && !bulletPattern.test(lines[index + 1] ?? "")) {
        parts.push(lines[index + 1] ?? "");
        index += 1;
      }
      bullets.push(parts.map((part) => part.trim()).join("\n"));
    }
  }
  return bullets;
}

/**
 * A spec tree's own scaffolding. Bare `index.md` / `intent.md` are named constantly in spec prose —
 * "a structurally invalid tree (missing `index.md`)", "the staged `intent.md` still ends with the
 * blocker" — describing the *subject* of the work, never a second artifact the bullet builds. Only
 * the bare forms are excluded: a genuine repo-relative path like `v2/spec/<name>/index.md` still
 * counts, because naming one alongside another artifact really is two artifacts.
 */
const SPEC_SCAFFOLDING_FILENAMES: ReadonlySet<string> = new Set(["index.md", "intent.md"]);
const GLOB_PATTERN = /[*?]|\[[^\]]+\]/u;

export function referencedArtifactPaths(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(BACKTICKED_PATH_PATTERN)) {
    const path = match[1] ?? match[2];
    if (path === undefined || SPEC_SCAFFOLDING_FILENAMES.has(path) || GLOB_PATTERN.test(path)) continue;
    paths.add(path);
  }
  return [...paths];
}

// Bare `green` and `stops` are deliberately absent: they fire on ordinary prose about new work
// ("lands with the suite green", "a guard that stops the retry"), which is not a preservation claim.
const PRESERVATION_VERB_PATTERN = /\b(?:stays?|remains?|unchanged|preserved|continues?)\b/iu;
// Wide by intent. Both exemptions fail closed, per the spec: a false refusal costs a reword, a false
// accept silently hides a fat bullet.
const BUILD_VERB_PATTERN =
  /\b(?:creates?|adds?|introduces?|implements?|builds?|generates?|writes?|gains?|gets?|grows?|learns?|emits?|extends?|wires?|routes?|threads?)\b/iu;
const SHARED_OUTCOME_PATTERN = /\bidentical\b|\bthe same\b/iu;

/** A bullet claiming named artifacts stay unchanged (preservation wording, no build verb anywhere in
 * the bullet) — exempt from the single-artifact count. */
function isStaysUnchangedBullet(text: string): boolean {
  return PRESERVATION_VERB_PATTERN.test(text) && !BUILD_VERB_PATTERN.test(text);
}

/**
 * A bullet stating one outcome holds identically across the named artifacts, rather than a distinct
 * build claim per artifact — exempt from the single-artifact count. The marker alone is not enough:
 * "the same" and "identical" are ordinary incidental prose ("in the same directory", "the same shape"),
 * so a bullet that also makes a build claim is not exempt.
 */
function isSharedDecisionBullet(text: string): boolean {
  return SHARED_OUTCOME_PATTERN.test(text) && !BUILD_VERB_PATTERN.test(text);
}

function assertSingleArtifactBullets(file: string, heading: string, bullets: readonly string[]): void {
  for (const bullet of bullets) {
    const paths = referencedArtifactPaths(bullet);
    if (paths.length <= 1) continue;
    if (isStaysUnchangedBullet(bullet) || isSharedDecisionBullet(bullet)) continue;
    // A bullet carrying exempt wording that reaches here did so because of its build claim; say so,
    // rather than leaving the author to guess which reading fired.
    const reading =
      PRESERVATION_VERB_PATTERN.test(bullet) || SHARED_OUTCOME_PATTERN.test(bullet)
        ? "mixes exempt wording with a build claim"
        : "read as built or changed";
    throw new Error(
      `Plan subspec ${file} has a ${heading} bullet naming multiple artifact paths (${paths.join(", ")}): ${bullet} (${reading})`,
    );
  }
}

function assertIndexLinks(indexBody: string, sourceFiles: readonly string[]): void {
  const linked = new Set<string>();
  const lines = indexBody.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    // The link may carry a trailing annotation (`— why`, `(after 00)`), so the pattern must not
    // anchor at the closing paren: the publication-side check (`publication-landing.ts`) reads the
    // same lines, and a well-formed annotated link read as absent blocks a complete draft.
    const match = line.match(/^\s*-\s\[[ xX]\]\s+\[[^\]]+\]\((?:\.\/)?([^)]+)\)/u);
    const file = match?.[1];
    if (file === undefined || !/^\d{2}-.*\.md$/u.test(file)) continue;
    if (!sourceFiles.includes(file)) throw new Error(`Plan index links unknown subspec ${file}`);
    if (linked.has(file)) throw new Error(`Plan index links ${file} more than once`);
    linked.add(file);
  }
  for (const file of sourceFiles) {
    if (!linked.has(file)) throw new Error(`Plan index does not link ${file}`);
  }
}

/** Validates that the authored plan index links every authored subspec exactly once. */
export function normalizePlanDraftSpecDir(specDir: string): void {
  const sourceFiles = readdirSync(specDir)
    .filter((file) => /^\d{2}-.*\.md$/u.test(file))
    .sort();
  const indexBody = readFileSync(join(specDir, "index.md"), "utf8");
  assertIndexLinks(indexBody, sourceFiles);
  for (const file of sourceFiles) {
    const body = readFileSync(join(specDir, file), "utf8");
    if (!body.replace(/\r\n/g, "\n").split("\n").includes("## Acceptance criteria")) {
      throw new Error(`Plan subspec ${file} is missing ## Acceptance criteria`);
    }
    for (const [heading, bulletPattern] of [
      ["## Acceptance criteria", CHECKBOX_BULLET_PATTERN],
      ["## Decisions", PLAIN_BULLET_PATTERN],
      ["## Documentation updates", PLAIN_BULLET_PATTERN],
    ] as const) {
      assertSingleArtifactBullets(file, heading, sectionBulletTexts(body, heading, bulletPattern));
    }
  }
}
