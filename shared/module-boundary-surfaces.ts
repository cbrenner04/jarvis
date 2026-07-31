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

type DependencyEdge = readonly [ModuleBoundarySurface, ModuleBoundarySurface];

const BEFORE_EDGE_PATTERN = /\b(?:lands\s+)?(?:implement\s+)?before\b/i;

function pairwiseEdges(
  left: readonly ModuleBoundarySurface[],
  right: readonly ModuleBoundarySurface[],
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (const before of left) for (const after of right) if (before !== after) edges.push([before, after]);
  return edges;
}

function sequentialEdges(surfaces: readonly ModuleBoundarySurface[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (let index = 1; index < surfaces.length; index += 1) {
    const before = surfaces[index - 1];
    const after = surfaces[index];
    if (before !== undefined && after !== undefined && before !== after) edges.push([before, after]);
  }
  return edges;
}

function parseBodyLines(body: string): string[] {
  return body.replace(/\r\n/g, "\n").split("\n");
}

function sectionBounds(lines: string[], heading: string): { contentStart: number; contentEnd: number } | undefined {
  const headingIndex = lines.indexOf(heading);
  if (headingIndex === -1) return undefined;
  const nextHeading = lines.findIndex((line, index) => index > headingIndex && /^##\s/u.test(line ?? ""));
  return { contentStart: headingIndex + 1, contentEnd: nextHeading === -1 ? lines.length : nextHeading };
}

function sectionText(body: string, heading: string): string {
  const lines = parseBodyLines(body);
  const bounds = sectionBounds(lines, heading);
  if (!bounds) return "";
  return lines.slice(bounds.contentStart, bounds.contentEnd).join("\n");
}

function parseBeforeEdges(text: string): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (const segment of text.split(/\n+/u)) {
    const match = BEFORE_EDGE_PATTERN.exec(segment);
    if (!match) continue;
    edges.push(
      ...pairwiseEdges(
        classifyModuleBoundaryText(segment.slice(0, match.index)),
        classifyModuleBoundaryText(segment.slice(match.index + match[0].length)),
      ),
    );
  }
  return edges;
}

function parseNumberedListEdges(text: string): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const numberedItems: ModuleBoundarySurface[][] = [];
  for (const line of text.split(/\n+/u)) {
    const itemMatch = line.match(/^\s*\d+[.)]\s+(.+)$/u);
    if (!itemMatch?.[1]) continue;
    const surfaces = classifyModuleBoundaryText(itemMatch[1]);
    if (surfaces.length > 0) numberedItems.push(surfaces);
  }
  for (let index = 0; index < numberedItems.length - 1; index += 1) {
    edges.push(...pairwiseEdges(numberedItems[index] ?? [], numberedItems[index + 1] ?? []));
  }
  const inlineMatches = [...text.matchAll(/\d+[.)]\s*([^.\d\n]+?)(?=\s*\d+[.)]|$)/gu)];
  if (inlineMatches.length >= 2) {
    edges.push(...sequentialEdges(inlineMatches.flatMap((match) => classifyModuleBoundaryText(match[1] ?? ""))));
  }
  return edges;
}

function parsePrerequisiteEdges(text: string): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const requiresPattern = /\b(?:requires?|depends?\s+on)\b/i;
  for (const line of text.split(/\n+/u)) {
    const bullet = line.match(/^\s*-\s+(.+)$/u);
    if (!bullet?.[1]) continue;
    if (BEFORE_EDGE_PATTERN.test(bullet[1])) {
      edges.push(...parseBeforeEdges(bullet[1]));
      continue;
    }
    const match = requiresPattern.exec(bullet[1]);
    if (!match) continue;
    const dependents = classifyModuleBoundaryText(bullet[1].slice(0, match.index));
    const prerequisites = classifyModuleBoundaryText(bullet[1].slice(match.index + match[0].length));
    if (dependents.length === 0 || prerequisites.length === 0) continue;
    edges.push(...pairwiseEdges(prerequisites, dependents));
  }
  return edges;
}

/** Topological sort of split boundaries; cycles and contradictory explicit edges hard-error. */
export function orderModuleBoundariesForSplit(
  draftBody: string,
  boundaries: readonly ModuleBoundarySurface[],
): ModuleBoundarySurface[] {
  if (boundaries.length < 2) return [...boundaries];
  const canonicalOrder = MODULE_BOUNDARY_SURFACES.filter((surface) => boundaries.includes(surface));
  const primaryText = [sectionText(draftBody, "## Decisions"), sectionText(draftBody, "## Tasks")].join("\n");
  const prerequisiteText = sectionText(draftBody, "## Prerequisites");
  const primary = [...parseBeforeEdges(primaryText), ...parseNumberedListEdges(primaryText)];
  const secondary = [
    ...parseBeforeEdges(prerequisiteText),
    ...parseNumberedListEdges(prerequisiteText),
    ...parsePrerequisiteEdges(prerequisiteText),
  ];
  const boundarySet = new Set(boundaries);
  const inScope = (edge: DependencyEdge) => boundarySet.has(edge[0]) && boundarySet.has(edge[1]) && edge[0] !== edge[1];
  const scopedPrimary = primary.filter(inScope);
  const scopedSecondary = secondary.filter(inScope);
  let edges = scopedSecondary;
  if (scopedPrimary.length > 0) {
    edges = [...scopedPrimary];
    const reversePrimary = new Set(scopedPrimary.map(([before, after]) => `${after}->${before}`));
    for (const [before, after] of scopedSecondary) {
      if (!reversePrimary.has(`${before}->${after}`)) edges.push([before, after]);
    }
  }
  if (edges.length === 0) return canonicalOrder;

  const byCanonicalOrder = (left: ModuleBoundarySurface, right: ModuleBoundarySurface) =>
    MODULE_BOUNDARY_SURFACES.indexOf(left) - MODULE_BOUNDARY_SURFACES.indexOf(right);

  const inDegree = new Map<ModuleBoundarySurface, number>(canonicalOrder.map((surface) => [surface, 0]));
  const adjacency = new Map<ModuleBoundarySurface, Set<ModuleBoundarySurface>>(
    canonicalOrder.map((surface) => [surface, new Set<ModuleBoundarySurface>()]),
  );
  for (const [before, after] of edges) {
    const next = adjacency.get(before);
    if (next?.has(after)) continue;
    next?.add(after);
    inDegree.set(after, (inDegree.get(after) ?? 0) + 1);
  }

  const ready = canonicalOrder.filter((surface) => (inDegree.get(surface) ?? 0) === 0).sort(byCanonicalOrder);
  const ordered: ModuleBoundarySurface[] = [];
  while (ready.length > 0) {
    const next = ready.shift();
    if (next === undefined) break;
    ordered.push(next);
    for (const after of adjacency.get(next) ?? []) {
      const degree = (inDegree.get(after) ?? 0) - 1;
      inDegree.set(after, degree);
      if (degree === 0) {
        ready.push(after);
        ready.sort(byCanonicalOrder);
      }
    }
  }
  if (ordered.length !== canonicalOrder.length) {
    throw new Error("Plan draft declares contradictory module-boundary dependency order");
  }
  return ordered;
}

type BulletBlock = {
  lines: string[];
  text: string;
  surfaces: ModuleBoundarySurface[];
};

type DraftSubspec = {
  body: string;
  criteria: BulletBlock[];
  file: string;
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

const CHECKBOX_BULLET_PATTERN = /^\s*-\s\[[ xX]\]\s+(.+)$/u;
const PLAIN_BULLET_PATTERN = /^\s*-\s+(?!\[[ xX]\])\s*(.*)$/u;

function sectionBullets(body: string, heading: string, bulletPattern: RegExp): BulletBlock[] {
  const lines = parseBodyLines(body);
  const bounds = sectionBounds(lines, heading);
  if (!bounds) return [];
  const { contentStart, contentEnd } = bounds;
  const blocks: BulletBlock[] = [];

  for (let index = contentStart; index < contentEnd; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(bulletPattern);
    if (!match?.[1]) continue;
    const blockLines = [line];
    while (index + 1 < contentEnd && !bulletPattern.test(lines[index + 1] ?? "")) {
      blockLines.push(lines[index + 1] ?? "");
      index += 1;
    }
    const blockText = [match[1], ...blockLines.slice(1)].map((part) => part.trim()).join("\n");
    blocks.push({
      lines: blockLines,
      text: blockText,
      surfaces: classifyModuleBoundaryText(blockText),
    });
  }

  return blocks;
}

function acceptanceCriteria(body: string, file: string): BulletBlock[] {
  if (!body.includes("## Acceptance criteria")) {
    throw new Error(`Plan subspec ${file} is missing ## Acceptance criteria`);
  }
  return sectionBullets(body, "## Acceptance criteria", CHECKBOX_BULLET_PATTERN);
}

function bulletsForBoundary(
  bullets: readonly BulletBlock[],
  surface: ModuleBoundarySurface,
  boundaryIndex: number,
): BulletBlock[] {
  // Mutation checkpoint: replacing this filter with `return [...bullets]` must turn the k2
  // draft-scope preservation assertions in `module-boundary-surfaces.test.ts` RED.
  return bullets.filter(
    (bullet) => bullet.surfaces[0] === surface || (boundaryIndex === 0 && bullet.surfaces.length === 0),
  );
}

function assertSingleSurfaceBullets(file: string, heading: string, bullets: readonly BulletBlock[]): void {
  const ambiguous = bullets.find((bullet) => bullet.surfaces.length > 1);
  if (ambiguous) {
    throw new Error(`Plan subspec ${file} has a multi-surface ${heading} bullet: ${ambiguous.text}`);
  }
}

function assertBulletsInSplitBoundaries(
  file: string,
  heading: string,
  bullets: readonly BulletBlock[],
  boundaries: readonly ModuleBoundarySurface[],
): void {
  const boundarySet = new Set(boundaries);
  const orphan = bullets.find((bullet) => {
    const surface = bullet.surfaces[0];
    return surface !== undefined && !boundarySet.has(surface);
  });
  if (orphan) {
    throw new Error(`Plan subspec ${file} has an out-of-union ${heading} bullet: ${orphan.text}`);
  }
}

function replaceTitle(body: string, title: string): string {
  const lines = parseBodyLines(body);
  const h1 = lines.findIndex((line) => /^#\s+/u.test(line ?? ""));
  if (h1 === -1) return body;
  lines[h1] = `# ${title}`;
  return lines.join("\n");
}

function replaceSectionBullets(
  body: string,
  heading: string,
  bullets: readonly BulletBlock[],
  padAfter = false,
): string {
  const lines = parseBodyLines(body);
  const bounds = sectionBounds(lines, heading);
  if (!bounds) return body;
  const replacement = bullets.length > 0 ? ["", ...bullets.flatMap((bullet) => bullet.lines)] : [""];
  if (bounds.contentEnd < lines.length && (bullets.length > 0 || padAfter)) replacement.push("");
  lines.splice(bounds.contentStart, bounds.contentEnd - bounds.contentStart, ...replacement);
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

/** Split and contiguously renumber a staged plan draft by acceptance-criterion module boundary. */
export function normalizePlanDraftSpecDir(specDir: string): void {
  const sourceFiles = readdirSync(specDir)
    .filter((file) => /^\d{2}-.*\.md$/u.test(file))
    .sort();
  const drafts: DraftSubspec[] = sourceFiles.map((file) => {
    const body = readFileSync(join(specDir, file), "utf8");
    return { body, criteria: acceptanceCriteria(body, file), file };
  });

  const indexPath = join(specDir, "index.md");
  const indexBody = readFileSync(indexPath, "utf8");
  assertIndexLinks(indexBody, sourceFiles);
  if (!drafts.some((draft) => spansMultipleModuleBoundaries(draft.criteria.map((criterion) => criterion.text)))) return;

  let emittedIndex = 0;
  const replacements = new Map<string, EmittedSubspec[]>();
  for (const draft of drafts) {
    const boundaries = orderModuleBoundariesForSplit(
      draft.body,
      moduleBoundariesForAcceptanceCriteria(draft.criteria.map((criterion) => criterion.text)),
    );
    if (boundaries.length < 2) {
      const file = `${emittedIndex.toString().padStart(2, "0")}-${draft.file.slice(3)}`;
      replacements.set(draft.file, [{ body: draft.body, file }]);
      emittedIndex += 1;
      continue;
    }

    const decisionBullets = sectionBullets(draft.body, "## Decisions", PLAIN_BULLET_PATTERN);
    const documentationBullets = sectionBullets(draft.body, "## Documentation updates", PLAIN_BULLET_PATTERN);
    for (const [heading, bullets] of [
      ["## Acceptance criteria", draft.criteria],
      ["## Decisions", decisionBullets],
      ["## Documentation updates", documentationBullets],
    ] as const) {
      assertSingleSurfaceBullets(draft.file, heading, bullets);
    }
    for (const [heading, bullets] of [
      ["## Decisions", decisionBullets],
      ["## Documentation updates", documentationBullets],
    ] as const) {
      assertBulletsInSplitBoundaries(draft.file, heading, bullets, boundaries);
    }

    const children = boundaries.map((surface, boundaryIndex) => {
      const { title } = SURFACES[surface];
      const criteria = bulletsForBoundary(draft.criteria, surface, boundaryIndex);
      const decisions = bulletsForBoundary(decisionBullets, surface, boundaryIndex);
      const documentation = bulletsForBoundary(documentationBullets, surface, boundaryIndex);
      const prefix = emittedIndex.toString().padStart(2, "0");
      emittedIndex += 1;
      let body = replaceTitle(draft.body, title);
      body = replaceSectionBullets(body, "## Acceptance criteria", criteria, true);
      body = replaceSectionBullets(body, "## Decisions", decisions);
      body = replaceSectionBullets(body, "## Documentation updates", documentation);
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
