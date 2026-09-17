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

/** A bare extension or naming-convention suffix (`.test-support.ts`, the un-starred form of
 * `*.test-support.ts`) rather than a real filename: starts with `.` and has a second `.` later.
 * A single-dot root dotfile (`.gitignore`) has no second dot, so it is untouched by this check and
 * stays excluded solely by the extension allowlist, as before. */
function isBareSuffix(path: string): boolean {
  return path.startsWith(".") && path.indexOf(".", 1) !== -1;
}

const RULES_OUT_PATTERN = /rules out/giu;
// A rules-out clause ends at the bullet's end, or earlier at a `;` or em dash that starts a
// distinct trailing clause — whichever comes first — so a second build claim after the rules-out
// clause still counts (`builds a.ts — rules out b.ts; adds c.ts`).
const CLAUSE_BOUNDARY_PATTERN = /;| — /u;

/** Named paths inside a `rules out` clause are mentions, not artifacts — exempt from the count. */
function rulesOutClauseRanges(text: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  for (const match of text.matchAll(RULES_OUT_PATTERN)) {
    const start = match.index ?? 0;
    const boundary = text.slice(start).match(CLAUSE_BOUNDARY_PATTERN);
    const end = boundary?.index === undefined ? text.length : start + boundary.index;
    ranges.push([start, end]);
  }
  return ranges;
}

export function referencedArtifactPaths(text: string): string[] {
  const paths = new Set<string>();
  const rulesOutRanges = rulesOutClauseRanges(text);
  for (const match of text.matchAll(BACKTICKED_PATH_PATTERN)) {
    const path = match[1] ?? match[2];
    if (path === undefined || SPEC_SCAFFOLDING_FILENAMES.has(path) || GLOB_PATTERN.test(path)) continue;
    if (match[1] === undefined && isBareSuffix(path)) continue;
    const matchIndex = match.index ?? 0;
    if (rulesOutRanges.some(([start, end]) => matchIndex >= start && matchIndex < end)) continue;
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

const ACCEPTANCE_CRITERIA_HEADING = "## Acceptance criteria";
const DOCUMENTATION_UPDATES_HEADING = "## Documentation updates";
const TEST_FILENAME_PATTERN = /^(.+)\.test\.([A-Za-z0-9]+)$/u;
const MARKDOWN_PATH_PATTERN = /\.md$/u;

/** The production path a test path would cover: same directory, filename with `.test` removed.
 * Undefined when the path isn't shaped like this repo's co-located test convention. */
function coveredProductionPath(testPath: string): string | undefined {
  const slashIndex = testPath.lastIndexOf("/");
  const dir = slashIndex === -1 ? "" : testPath.slice(0, slashIndex + 1);
  const filename = slashIndex === -1 ? testPath : testPath.slice(slashIndex + 1);
  const match = filename.match(TEST_FILENAME_PATTERN);
  if (!match) return undefined;
  const [, stem, ext] = match;
  return `${dir}${stem}.${ext}`;
}

/** In an Acceptance-criteria bullet, a test path plus the production path it covers (same
 * directory, `.test` removed) counts as one artifact — collapses each such pair down to the
 * production path. A path not part of a pairing still counts individually. */
function collapseTestCoveragePairs(paths: readonly string[]): string[] {
  const remaining = new Set(paths);
  for (const path of paths) {
    const production = coveredProductionPath(path);
    if (production !== undefined && remaining.has(production)) remaining.delete(path);
  }
  return paths.filter((path) => remaining.has(path));
}

/** In a Documentation-updates bullet, the leading path (first occurrence order) is the artifact;
 * a later path is a mention unless it is itself a markdown path, which still counts distinctly. */
function collapseDocBulletMentions(paths: readonly string[]): string[] {
  const [leading, ...rest] = paths;
  if (leading === undefined) return [];
  return [leading, ...rest.filter((path) => MARKDOWN_PATH_PATTERN.test(path))];
}

function assertSingleArtifactBullets(file: string, heading: string, bullets: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const bullet of bullets) {
    const paths = referencedArtifactPaths(bullet);
    const countedPaths =
      heading === ACCEPTANCE_CRITERIA_HEADING
        ? collapseTestCoveragePairs(paths)
        : heading === DOCUMENTATION_UPDATES_HEADING
          ? collapseDocBulletMentions(paths)
          : paths;
    if (countedPaths.length <= 1) continue;
    if (isStaysUnchangedBullet(bullet) || isSharedDecisionBullet(bullet)) continue;
    // A bullet carrying exempt wording that reaches here did so because of its build claim; say so,
    // rather than leaving the author to guess which reading fired.
    const reading =
      PRESERVATION_VERB_PATTERN.test(bullet) || SHARED_OUTCOME_PATTERN.test(bullet)
        ? "mixes exempt wording with a build claim"
        : "read as built or changed";
    offenders.push(
      `Plan subspec ${file} has a ${heading} bullet naming multiple artifact paths (${countedPaths.join(", ")}): ${bullet} (${reading})`,
    );
  }
  return offenders;
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
  const offenders: string[] = [];
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
      offenders.push(...assertSingleArtifactBullets(file, heading, sectionBulletTexts(body, heading, bulletPattern)));
    }
  }
  if (offenders.length > 0) throw new Error(offenders.join("\n"));
}
