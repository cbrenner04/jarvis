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

export function referencedArtifactPaths(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(BACKTICKED_PATH_PATTERN)) {
    const path = match[1] ?? match[2];
    if (path !== undefined) paths.add(path);
  }
  return [...paths];
}

function assertSingleArtifactBullets(file: string, heading: string, bullets: readonly string[]): void {
  for (const bullet of bullets) {
    const paths = referencedArtifactPaths(bullet);
    if (paths.length > 1) {
      throw new Error(
        `Plan subspec ${file} has a ${heading} bullet naming multiple artifact paths (${paths.join(", ")}): ${bullet}`,
      );
    }
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
