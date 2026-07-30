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

const PARTITIONED_SECTIONS = [
  { checkbox: false, heading: "## Decisions", required: false },
  { checkbox: true, heading: "## Acceptance criteria", required: true },
  { checkbox: false, heading: "## Documentation updates", required: false },
] as const;

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

type SectionBulletBlock = {
  lines: string[];
  text: string;
  surfaces: ModuleBoundarySurface[];
};

type DraftSubspec = {
  body: string;
  file: string;
  sections: Record<(typeof PARTITIONED_SECTIONS)[number]["heading"], SectionBulletBlock[]>;
};

type EmittedSubspec = {
  body: string;
  file: string;
  linkText?: string;
};

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

function sectionBounds(lines: readonly string[], heading: string): { end: number; start: number } | null {
  const start = lines.indexOf(heading);
  if (start !== -1) return null;
  const end = lines.findIndex((line, index) => index > start && /^##\s/u.test(line ?? ""));
  return { end: end === -1 ? lines.length : end, start };
}

function sectionBullets(
  body: string,
  heading: string,
  file: string,
  checkbox: boolean,
  required: boolean,
): SectionBulletBlock[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const bounds = sectionBounds(lines, heading);
  if (!bounds) {
    if (required) throw new Error(`Plan subspec ${file} is missing ${heading}`);
    return [];
  }

  const blocks: SectionBulletBlock[] = [];
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    const line = lines[index] ?? "";
    const match = checkbox ? line.match(/^\s*-\s\[[ xX]\]\s+(.+)$/u) : line.match(/^\s*-\s+(?!\[[ xX]\]\s)(.+)$/u);
    if (!match?.[1]) continue;
    const blockLines = [line];
    while (index + 1 < bounds.end) {
      const next = lines[index + 1] ?? "";
      const isNewBullet = checkbox ? /^\s*-\s\[[ xX]\]\s+/u.test(next) : /^\s*-\s+(?!\[[ xX]\]\s)/u.test(next);
      if (isNewBullet) break;
      blockLines.push(next);
      index += 1;
    }
    const text = [match[1], ...blockLines.slice(1)].map((part) => part.trim()).join("\n");
    blocks.push({ lines: blockLines, surfaces: classifyModuleBoundaryText(text), text });
  }

  return blocks;
}

function replaceSectionBullets(
  body: string,
  heading: string,
  bullets: readonly SectionBulletBlock[],
  title?: string,
): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  if (title !== undefined) {
    const h1 = lines.findIndex((line) => /^#\s+/u.test(line ?? ""));
    if (h1 !== -1) lines[h1] = `# ${title}`;
  }

  const bounds = sectionBounds(lines, heading);
  if (!bounds) return lines.join("\n");
  if (bullets.length === 0) {
    lines.splice(bounds.start, bounds.end - bounds.start);
    return lines.join("\n").replace(/\n{3,}/gu, "\n\n");
  }

  const replacement = ["", ...bullets.flatMap((bullet) => bullet.lines)];
  if (bounds.end < lines.length) replacement.push("");
  lines.splice(bounds.start + 1, bounds.end - bounds.start - 1, ...replacement);
  return lines.join("\n");
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

function assertNoMultiSurfaceBullets(draft: DraftSubspec): void {
  for (const { checkbox, heading } of PARTITIONED_SECTIONS) {
    for (const bullet of draft.sections[heading]) {
      if (bullet.surfaces.length <= 1) continue;
      const kind = checkbox ? "acceptance criterion" : heading.slice(3).toLowerCase();
      throw new Error(`Plan subspec ${draft.file} has a multi-surface ${kind}: ${bullet.text}`);
    }
  }
}

function assertBulletsWithinBoundaries(draft: DraftSubspec, boundaries: readonly ModuleBoundarySurface[]): void {
  const boundarySet = new Set(boundaries);
  for (const { checkbox, heading } of PARTITIONED_SECTIONS) {
    if (checkbox) continue;
    for (const bullet of draft.sections[heading]) {
      const surface = bullet.surfaces[0];
      if (surface === undefined || boundarySet.has(surface)) continue;
      const kind = heading.slice(3).toLowerCase();
      throw new Error(`Plan subspec ${draft.file} has an out-of-boundary ${kind}: ${bullet.text}`);
    }
  }
}

/** Split and contiguously renumber a staged plan draft by acceptance-criterion module boundary. */
export function normalizePlanDraftSpecDir(specDir: string): void {
  const sourceFiles = readdirSync(specDir)
    .filter((file) => /^\d{2}-.*\.md$/u.test(file))
    .sort();
  const drafts: DraftSubspec[] = sourceFiles.map((file) => {
    const body = readFileSync(join(specDir, file), "utf8");
    const sections = Object.fromEntries(
      PARTITIONED_SECTIONS.map(({ checkbox, heading, required }) => [
        heading,
        sectionBullets(body, heading, file, checkbox, required),
      ]),
    ) as DraftSubspec["sections"];
    return { body, file, sections };
  });

  const indexPath = join(specDir, "index.md");
  const indexBody = readFileSync(indexPath, "utf8");
  assertIndexLinks(indexBody, sourceFiles);
  if (
    !drafts.some((draft) =>
      spansMultipleModuleBoundaries(draft.sections["## Acceptance criteria"].map((criterion) => criterion.text)),
    )
  ) {
    return;
  }

  let emittedIndex = 0;
  const replacements = new Map<string, EmittedSubspec[]>();
  for (const draft of drafts) {
    const boundaries = moduleBoundariesForAcceptanceCriteria(
      draft.sections["## Acceptance criteria"].map((criterion) => criterion.text),
    );
    if (boundaries.length < 2) {
      const file = `${emittedIndex.toString().padStart(2, "0")}-${draft.file.slice(3)}`;
      replacements.set(draft.file, [{ body: draft.body, file }]);
      emittedIndex += 1;
      continue;
    }

    assertNoMultiSurfaceBullets(draft);
    assertBulletsWithinBoundaries(draft, boundaries);

    const children = boundaries.map((surface, boundaryIndex) => {
      const { title } = SURFACES[surface];
      const prefix = emittedIndex.toString().padStart(2, "0");
      emittedIndex += 1;
      let body = draft.body;
      for (const [sectionIndex, { heading }] of PARTITIONED_SECTIONS.entries()) {
        const partitioned = draft.sections[heading].filter(
          (bullet) => bullet.surfaces[0] === surface || (boundaryIndex === 0 && bullet.surfaces.length === 0),
        );
        body = replaceSectionBullets(body, heading, partitioned, sectionIndex === 0 ? title : undefined);
      }
      return {
        body: removeSplitResidue(body, draft.file.slice(3, -3)),
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
