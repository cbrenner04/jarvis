import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MODULE_BOUNDARY_SURFACES = ["persistence", "daemon", "cli", "execution-loop"] as const;

export type ModuleBoundarySurface = (typeof MODULE_BOUNDARY_SURFACES)[number];

const SURFACES: Record<ModuleBoundarySurface, { patterns: readonly RegExp[]; title: string }> = {
  persistence: {
    patterns: [/\bpersist(?:ed|ence|ent|ing|s)?\b/i, /\bstate[- ]store\b/i, /\b(?:database|sqlite|storage)\b/i],
    title: "Persistence",
  },
  daemon: { patterns: [/\bdaemon\b/i, /\b(?:ipc|rpc)\b/i, /\bsocket\b/i], title: "Daemon" },
  cli: { patterns: [/\bcli\b/i, /\bcommand[- ]line\b/i, /\bsubcommands?\b/i, /\bflags?\b/i], title: "CLI" },
  "execution-loop": {
    patterns: [
      /\bexecution[- ]loop\b/i,
      /\bwrite[- ]loop\b/i,
      /\battempt[- ]loop\b/i,
      /\b(?:step|workflow)[- ]runner\b/i,
    ],
    title: "Execution loop",
  },
};

export function classifyModuleBoundaryText(text: string): ModuleBoundarySurface[] {
  return MODULE_BOUNDARY_SURFACES.filter((surface) => SURFACES[surface].patterns.some((pattern) => pattern.test(text)));
}

export function moduleBoundariesForAcceptanceCriteria(acceptanceCriteria: readonly string[]): ModuleBoundarySurface[] {
  const matched = new Set(acceptanceCriteria.flatMap(classifyModuleBoundaryText));
  return MODULE_BOUNDARY_SURFACES.filter((surface) => matched.has(surface));
}

export function spansMultipleModuleBoundaries(acceptanceCriteria: readonly string[]): boolean {
  return moduleBoundariesForAcceptanceCriteria(acceptanceCriteria).length > 1;
}

type SectionBullet = {
  lines: string[];
  text: string;
  surfaces: ModuleBoundarySurface[];
};

type DraftSubspec = {
  body: string;
  criteria: SectionBullet[];
  decisions: SectionBullet[];
  documentationUpdates: SectionBullet[];
  file: string;
};

type EmittedSubspec = {
  body: string;
  file: string;
  linkText?: string;
};

let invertPartitionPreservationGuardForTest = false;

export function setInvertPartitionPreservationGuardForTest(value: boolean): void {
  invertPartitionPreservationGuardForTest = value;
}

export function splitResiduePattern(parentSlug: string): RegExp {
  const escapedSlug = parentSlug.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b(?:split[- ]from|${escapedSlug}|(?:phase|milestone|slice)\\s+\\d+)\\b`, "iu");
}

function removeSplitResidue(body: string, parentSlug: string): string {
  const residue = splitResiduePattern(parentSlug);
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !residue.test(line))
    .join("\n");
}

function sectionBullets(body: string, sectionHeading: string, checkbox: boolean): SectionBullet[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const heading = lines.indexOf(sectionHeading);
  if (heading === -1) return [];
  const end = lines.findIndex((line, index) => index > heading && /^##\s/u.test(line ?? ""));
  const sectionEnd = end === -1 ? lines.length : end;
  const bulletRe = checkbox ? /^\s*-\s\[[ xX]\]\s+(.+)$/u : /^\s*-\s+(.+)$/u;
  const blocks: SectionBullet[] = [];

  for (let index = heading + 1; index < sectionEnd; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(bulletRe);
    if (!match?.[1]) continue;
    const blockLines = [line];
    while (index + 1 < sectionEnd && !bulletRe.test(lines[index + 1] ?? "")) {
      blockLines.push(lines[index + 1] ?? "");
      index += 1;
    }
    const text = [match[1], ...blockLines.slice(1)].map((part) => part.trim()).join("\n");
    blocks.push({ lines: blockLines, text, surfaces: classifyModuleBoundaryText(text) });
  }

  return blocks;
}

function acceptanceCriteria(body: string, file: string): SectionBullet[] {
  if (!body.includes("## Acceptance criteria")) throw new Error(`Plan subspec ${file} is missing ## Acceptance criteria`);
  return sectionBullets(body, "## Acceptance criteria", true);
}

function replaceSectionBullets(
  body: string,
  sectionHeading: string,
  bullets: readonly SectionBullet[],
  title?: string,
): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  if (title !== undefined) {
    const h1 = lines.findIndex((line) => /^#\s+/u.test(line ?? ""));
    if (h1 !== -1) lines[h1] = `# ${title}`;
  }
  const heading = lines.indexOf(sectionHeading);
  if (heading === -1) return body;
  const end = lines.findIndex((line, index) => index > heading && /^##\s/u.test(line ?? ""));
  const sectionEnd = end === -1 ? lines.length : end;
  const replacement = bullets.length === 0 ? [""] : ["", ...bullets.flatMap((bullet) => bullet.lines)];
  if (sectionEnd < lines.length) replacement.push("");
  lines.splice(heading + 1, sectionEnd - heading - 1, ...replacement);
  return lines.join("\n");
}

function filterBulletsForBoundary(
  bullets: readonly SectionBullet[],
  surface: ModuleBoundarySurface,
  boundaryIndex: number,
): SectionBullet[] {
  const matches = (bullet: SectionBullet): boolean =>
    bullet.surfaces[0] === surface || (boundaryIndex === 0 && bullet.surfaces.length === 0);
  return bullets.filter((bullet) => (invertPartitionPreservationGuardForTest ? !matches(bullet) : matches(bullet)));
}

function renumberedLinkText(text: string, index: number): string {
  const prefix = index.toString().padStart(2, "0");
  return /^\d{2}\s*-\s*/u.test(text) ? text.replace(/^\d{2}\s*-\s*/u, `${prefix} - `) : text;
}

function rewriteIndex(indexBody: string, replacements: ReadonlyMap<string, readonly EmittedSubspec[]>): string {
  const seen = new Set<string>();
  const lines = indexBody.replace(/\r\n/g, "\n").split("\n");
  const rewritten = lines.flatMap((line) => {
    const match = line.match(/^(\s*-\s\[[ xX]\]\s+)\[([^\]]+)\]\((?:\.\/)?([^)]+)\)$/u);
    const sourceFile = match?.[3];
    if (!match || !sourceFile || !replacements.has(sourceFile)) return [line];
    if (seen.has(sourceFile)) throw new Error(`Plan index links ${sourceFile} more than once`);
    seen.add(sourceFile);
    return (replacements.get(sourceFile) ?? []).map((child) => {
      const linkText = child.linkText || renumberedLinkText(match[2] ?? "", Number(child.file.slice(0, 2)));
      return `${match[1]}[${linkText}](./${child.file})`;
    });
  });
  for (const sourceFile of replacements.keys()) {
    if (!seen.has(sourceFile)) throw new Error(`Plan index does not link ${sourceFile}`);
  }
  return rewritten.join("\n");
}

function assertIndexLinks(indexBody: string, sourceFiles: readonly string[]): void {
  const linked = new Set<string>();
  const lines = indexBody.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*-\s\[[ xX]\]\s+\[[^\]]+\]\((?:\.\/)?([^)]+)\)$/u);
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

function assertNoSplitResidue(outputs: readonly EmittedSubspec[], indexBody: string, parentSlug: string): void {
  const residue = splitResiduePattern(parentSlug);
  const durableOutput = [...outputs.flatMap((output) => [output.file, output.body]), indexBody].join("\n");
  if (residue.test(durableOutput)) {
    throw new Error(`Plan split left forbidden lineage for ${parentSlug}`);
  }
}

function partitionDraftBody(
  draft: DraftSubspec,
  surface: ModuleBoundarySurface,
  boundaryIndex: number,
  title: string,
  parentSlug: string,
): string {
  let body = replaceSectionBullets(
    draft.body,
    "## Acceptance criteria",
    filterBulletsForBoundary(draft.criteria, surface, boundaryIndex),
    title,
  );
  for (const [heading, bullets] of [
    ["## Decisions", draft.decisions],
    ["## Documentation updates", draft.documentationUpdates],
  ] as const) {
    body = replaceSectionBullets(body, heading, filterBulletsForBoundary(bullets, surface, boundaryIndex));
  }
  return removeSplitResidue(body, parentSlug);
}

/** Split and contiguously renumber a staged plan draft by acceptance-criterion module boundary. */
export function normalizePlanDraftSpecDir(specDir: string): void {
  const sourceFiles = readdirSync(specDir)
    .filter((file) => /^\d{2}-.*\.md$/u.test(file))
    .sort();
  const drafts: DraftSubspec[] = sourceFiles.map((file) => {
    const body = readFileSync(join(specDir, file), "utf8");
    return {
      body,
      criteria: acceptanceCriteria(body, file),
      decisions: sectionBullets(body, "## Decisions", false),
      documentationUpdates: sectionBullets(body, "## Documentation updates", false),
      file,
    };
  });

  const indexPath = join(specDir, "index.md");
  const indexBody = readFileSync(indexPath, "utf8");
  assertIndexLinks(indexBody, sourceFiles);
  if (!drafts.some((draft) => spansMultipleModuleBoundaries(draft.criteria.map((criterion) => criterion.text)))) return;

  let emittedIndex = 0;
  const replacements = new Map<string, EmittedSubspec[]>();
  for (const draft of drafts) {
    const boundaries = moduleBoundariesForAcceptanceCriteria(draft.criteria.map((criterion) => criterion.text));
    if (boundaries.length < 2) {
      const file = `${emittedIndex.toString().padStart(2, "0")}-${draft.file.slice(3)}`;
      replacements.set(draft.file, [{ body: draft.body, file }]);
      emittedIndex += 1;
      continue;
    }

    const ambiguous = [...draft.criteria, ...draft.decisions, ...draft.documentationUpdates].find(
      (bullet) => bullet.surfaces.length > 1,
    );
    if (ambiguous) {
      throw new Error(`Plan subspec ${draft.file} has a multi-surface bullet: ${ambiguous.text}`);
    }

    const parentSlug = draft.file.slice(3, -3);
    const children = boundaries.map((surface, boundaryIndex) => {
      const { title } = SURFACES[surface];
      const prefix = emittedIndex.toString().padStart(2, "0");
      emittedIndex += 1;
      return {
        body: partitionDraftBody(draft, surface, boundaryIndex, title, parentSlug),
        file: `${prefix}-${surface}.md`,
        linkText: `${prefix} - ${title}`,
      };
    });
    replacements.set(draft.file, children);
  }

  const rewrittenIndex = [...replacements.entries()].reduce(
    (body, [sourceFile]) => removeSplitResidue(body, sourceFile.slice(3, -3)),
    rewriteIndex(indexBody, replacements),
  );
  for (const [sourceFile, outputs] of replacements) {
    if (outputs.length > 1) assertNoSplitResidue(outputs, rewrittenIndex, sourceFile.slice(3, -3));
  }
  for (const sourceFile of sourceFiles) rmSync(join(specDir, sourceFile));
  for (const outputs of replacements.values()) {
    for (const output of outputs) writeFileSync(join(specDir, output.file), output.body);
  }
  writeFileSync(indexPath, rewrittenIndex);
}
