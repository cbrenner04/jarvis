import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { keepIssueReferencesOffLineStart, runMarkdownlintAutofix } from "./markdownlint-repair.ts";

export type IntentStageFile = { slug: string; path: string };
type Result = { ok: true; intents: IntentStageFile[] } | { ok: false; error: string };
const INTENT_FILE_RE = /^[a-z0-9-]+$/;

export function listIntentStageMarkdownFiles(stagingDir: string): string[] {
  return readdirSync(stagingDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(stagingDir, entry.name))
    .sort();
}

function parseFrontmatterName(text: string): string | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if ((lines[0] ?? "") !== "---") return null;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "") === "---") break;
    const match = /^name:\s*(.+)\s*$/.exec(lines[i] ?? "");
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function hasPrerequisites(text: string): boolean {
  return /^## Prerequisites\s*$/m.test(text.replace(/\r\n/g, "\n"));
}

function hasFirstBodyH1(text: string): boolean {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let body = 0;
  if (lines[0] === "---") {
    body = lines.findIndex((line, index) => index > 0 && line === "---") + 1;
  }
  for (let index = body; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length > 0) return /^#(?!#)\s+\S/.test(line);
  }
  return false;
}

function validPrerequisites(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = /^## Prerequisites\s*$/m.exec(normalized);
  if (match === null || match.index === undefined) return false;
  const after = normalized.slice(match.index + match[0].length);
  const next = after.search(/^##\s/m);
  const body = (next === -1 ? after : after.slice(0, next)).trim();
  if (body.length === 0) return true;
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .every((line) => /^- \S.*$/.test(line));
}

function normalizePrerequisitesSpacing(text: string): string {
  const lines = text.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === "## Prerequisites");
  if (headingIndex === -1) return text;
  let changed = false;
  let index = headingIndex;
  let beforeStart = index;
  while (beforeStart > 0 && (lines[beforeStart - 1] ?? "").trim() === "") beforeStart -= 1;
  if (beforeStart === index) {
    if (index > 0) {
      lines.splice(index, 0, "");
      index += 1;
      changed = true;
    }
  } else if (index - beforeStart > 1) {
    lines.splice(beforeStart, index - beforeStart - 1);
    index = beforeStart + 1;
    changed = true;
  }
  let afterEnd = index + 1;
  while (afterEnd < lines.length && (lines[afterEnd] ?? "").trim() === "") afterEnd += 1;
  const blankCountAfter = afterEnd - (index + 1);
  if (blankCountAfter === 0) {
    lines.splice(index + 1, 0, "");
    changed = true;
  } else if (blankCountAfter > 1) {
    lines.splice(index + 2, blankCountAfter - 1);
    changed = true;
  }
  return changed ? lines.join("\n") : text;
}

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Keep the repair ordering identical to v1; each branch handles a distinct malformed artifact.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the ordered repair contract is intentionally explicit
function repairIntentFile(path: string, slug: string): void {
  const content = readFileSync(path, "utf8");
  let text = content.replace(/\r\n/g, "\n");
  let modified = false;
  const lines = text.split("\n");
  let blockEndIdx = -1;
  const hasLeadingDash = (lines[0] ?? "") === "---";
  if (hasLeadingDash) {
    for (let i = 1; i < lines.length; i += 1)
      if ((lines[i] ?? "") === "---") {
        blockEndIdx = i;
        break;
      }
  }
  if (blockEndIdx === -1 && !hasLeadingDash) {
    lines.unshift("---", `name: ${slug}`, "---");
    blockEndIdx = 2;
    modified = true;
  } else if (blockEndIdx !== -1) {
    let nameLineIdx = -1;
    let nameValue: string | null = null;
    for (let i = 1; i < blockEndIdx; i += 1) {
      const match = /^name:\s*(.*)$/.exec(lines[i] ?? "");
      if (match) {
        nameLineIdx = i;
        nameValue = (match[1] ?? "").trim();
        break;
      }
    }
    if (nameLineIdx !== -1 && nameValue !== slug) {
      lines[nameLineIdx] = `name: ${slug}`;
      modified = true;
    } else if (nameLineIdx === -1) {
      lines.splice(blockEndIdx, 0, `name: ${slug}`);
      blockEndIdx += 1;
      modified = true;
    }
  }
  const bodyStartIdx = blockEndIdx !== -1 ? blockEndIdx + 1 : 0;
  let firstNonBlankIdx = -1;
  for (let i = bodyStartIdx; i < lines.length; i += 1)
    if ((lines[i] ?? "").trim().length > 0) {
      firstNonBlankIdx = i;
      break;
    }
  const derivedTitle = `# ${slugToTitle(slug)}`;
  if (firstNonBlankIdx !== -1) {
    const line = lines[firstNonBlankIdx] ?? "";
    const nameMatch = /^name:\s*(.*)$/.exec(line.trim());
    if (!/^#(?!#)\s+\S/.test(line)) {
      if (nameMatch && (nameMatch[1] ?? "").trim() === slug) lines[firstNonBlankIdx] = derivedTitle;
      else lines.splice(firstNonBlankIdx, 0, derivedTitle);
      modified = true;
    }
  } else {
    lines.push(derivedTitle);
    modified = true;
  }
  text = lines.join("\n");
  const fixedReferences = keepIssueReferencesOffLineStart(text);
  if (fixedReferences !== text) {
    text = fixedReferences;
    modified = true;
  }
  if (!hasPrerequisites(text)) {
    text = `${text.replace(/\n+$/, "")}\n\n## Prerequisites\n`;
    modified = true;
  }
  const normalized = normalizePrerequisitesSpacing(text);
  if (normalized !== text) {
    text = normalized;
    modified = true;
  }
  if (modified) writeFileSync(path, text, "utf8");
}

export function repairIntentStageContent(
  stagingDir: string,
  warn: (message: string) => void,
  harnessRootOverride?: string | null,
): void {
  for (const path of listIntentStageMarkdownFiles(stagingDir)) repairIntentFile(path, basename(path, ".md"));
  runMarkdownlintAutofix({
    files: listIntentStageMarkdownFiles(stagingDir),
    warn,
    ...(harnessRootOverride !== undefined ? { harnessRootOverride } : {}),
  });
}

export function validateIntentFilenames(files: string[]): Result {
  if (files.length === 0) return { ok: false, error: "intent: splitter produced no intent files" };
  const seen = new Set<string>();
  const intents: IntentStageFile[] = [];
  for (const path of files) {
    const slug = basename(path, ".md");
    if (!INTENT_FILE_RE.test(slug) || /^\d+-/.test(slug) || slug === "index")
      return {
        ok: false,
        error: `intent: invalid emitted filename ${basename(path)}; expected <name>.md with no ordering prefix`,
      };
    if (seen.has(slug)) return { ok: false, error: `intent: duplicate emitted name ${slug}` };
    seen.add(slug);
    intents.push({ slug, path });
  }
  return { ok: true, intents };
}

export function validateIntentStageContent(intents: IntentStageFile[]): Result {
  for (const { slug, path } of intents) {
    const content = readFileSync(path, "utf8");
    if (parseFrontmatterName(content) !== slug)
      return { ok: false, error: `intent: ${basename(path)} must declare name: ${slug}` };
    if (!hasFirstBodyH1(content))
      return { ok: false, error: `intent: ${basename(path)} must start its body with a level-one heading` };
    if (!hasPrerequisites(content))
      return { ok: false, error: `intent: ${basename(path)} is missing ## Prerequisites` };
    if (!validPrerequisites(content))
      return { ok: false, error: `intent: ${basename(path)} must list prerequisites as one bullet per line` };
  }
  return { ok: true, intents };
}

export function validateIntentStage(
  stagingDir: string,
  modifiedPaths: string[],
  warn: (message: string) => void,
  harnessRootOverride?: string | null,
): Result {
  const allowedPrefix = ".jarvis-intent-stage/";
  const rogue = modifiedPaths.filter((path) => path !== ".jarvis-intent-stage" && !path.startsWith(allowedPrefix));
  if (rogue.length > 0)
    return { ok: false, error: `intent: splitter wrote outside .jarvis-intent-stage/: ${rogue.join(", ")}` };
  const entries = readdirSync(stagingDir, { withFileTypes: true });
  for (const entry of entries)
    if (!entry.isFile() || !entry.name.endsWith(".md"))
      return { ok: false, error: `intent: invalid splitter output ${entry.name}; expected only markdown files` };
  const filenames = validateIntentFilenames(listIntentStageMarkdownFiles(stagingDir));
  if (!filenames.ok) return filenames;
  repairIntentStageContent(stagingDir, warn, harnessRootOverride);
  return validateIntentStageContent(filenames.intents);
}

export function validateIntentStageStructure(stagingDir: string): { ok: true } | { ok: false; error: string } {
  try {
    for (const entry of readdirSync(stagingDir, { withFileTypes: true }))
      if (!entry.isFile() || !entry.name.endsWith(".md"))
        return { ok: false, error: `intent: invalid splitter output ${entry.name}; expected only markdown files` };
  } catch {
    return { ok: false, error: "intent: failed to read stage directory" };
  }
  return { ok: true };
}
