export type StructuralTestLocatorKind = "marker-slice" | "symbol-slice" | "discovered-file" | "inventory-binding";

export const PARSE_ONLY_INVENTORY_MARKER_COMMENT = "// jarvis:parse-only-inventory";

export class StructuralTestLocatorError extends Error {
  readonly kind: StructuralTestLocatorKind;
  readonly searchKey: string;

  constructor(kind: StructuralTestLocatorKind, searchKey: string, message?: string) {
    super(message ?? `structural test locator ${kind} failed for ${searchKey}`);
    this.name = "StructuralTestLocatorError";
    this.kind = kind;
    this.searchKey = searchKey;
  }
}

export type MarkerSliceInput =
  | {
      text: string;
      start: string;
      end: string;
      searchKey?: string;
    }
  | {
      text: string;
      pattern: RegExp;
      searchKey?: string;
    };

export function locateMarkerSlice(input: MarkerSliceInput): string {
  if ("pattern" in input) {
    const match = input.text.match(input.pattern);
    if (match === null) {
      throw new StructuralTestLocatorError("marker-slice", input.searchKey ?? input.pattern.source);
    }
    const capture = match[1] ?? match[0];
    if (capture === undefined || capture === "") {
      throw new StructuralTestLocatorError("marker-slice", input.searchKey ?? input.pattern.source);
    }
    return capture;
  }

  const startIndex = input.text.indexOf(input.start);
  if (startIndex === -1) {
    throw new StructuralTestLocatorError("marker-slice", input.searchKey ?? input.start);
  }
  const sliceStart = startIndex + input.start.length;
  const endIndex = input.text.indexOf(input.end, sliceStart);
  if (endIndex === -1) {
    throw new StructuralTestLocatorError("marker-slice", input.searchKey ?? input.end);
  }
  return input.text.slice(sliceStart, endIndex);
}

export type SymbolSliceInput = {
  candidates: readonly string[];
  start: string;
  end: string;
  searchKey?: string;
};

export function locateSymbolSlice(input: SymbolSliceInput): string {
  const owner = input.candidates.find((text) => text.includes(input.start));
  if (owner === undefined) {
    throw new StructuralTestLocatorError("symbol-slice", input.searchKey ?? input.start);
  }
  const from = owner.indexOf(input.start);
  const toIndex = owner.indexOf(input.end, from + input.start.length);
  if (toIndex === -1) {
    throw new StructuralTestLocatorError("symbol-slice", input.searchKey ?? input.end);
  }
  return owner.slice(from, toIndex);
}

export function locateDiscoveredFile(discovered: Readonly<Record<string, string>>, relativePath: string): string {
  const content = discovered[relativePath];
  if (content === undefined) {
    throw new StructuralTestLocatorError("discovered-file", relativePath);
  }
  return content;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function indexOfMatchingCloseBracket(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function hasParseOnlyInventoryMarkerImmediatelyBefore(source: string, declarationStart: number): boolean {
  const before = source.slice(0, declarationStart);
  const markerIndex = before.lastIndexOf(PARSE_ONLY_INVENTORY_MARKER_COMMENT);
  if (markerIndex === -1) {
    return false;
  }
  const between = before.slice(markerIndex + PARSE_ONLY_INVENTORY_MARKER_COMMENT.length);
  return /^\s*$/.test(between);
}

function inventoryConstIsUnderscorePrefixed(matchText: string, constantName: string): boolean {
  return new RegExp(`(?:export\\s+)?const\\s+_${escapeRegExp(constantName)}\\b`).test(matchText);
}

type ParseOnlyInventoryCandidate = {
  body: string;
  declarationStart: number;
  isUnderscore: boolean;
  marked: boolean;
};

function collectParseOnlyInventoryCandidates(
  source: string,
  constantName: string,
  key: string,
  pattern: RegExp,
): { candidates: ParseOnlyInventoryCandidate[]; hasUnderscoreVariant: boolean } {
  const candidates: ParseOnlyInventoryCandidate[] = [];
  let hasUnderscoreVariant = false;

  for (const match of source.matchAll(pattern)) {
    const declarationStart = match.index;
    if (declarationStart === undefined) {
      continue;
    }
    const isUnderscore = inventoryConstIsUnderscorePrefixed(match[0], constantName);
    if (isUnderscore) {
      hasUnderscoreVariant = true;
    }
    const bracketIndex = declarationStart + match[0].length - 1;
    const closeIndex = indexOfMatchingCloseBracket(source, bracketIndex);
    if (closeIndex === -1) {
      throw new StructuralTestLocatorError("inventory-binding", key, `unclosed inventory array for ${constantName}`);
    }
    const body = source.slice(bracketIndex + 1, closeIndex);
    candidates.push({ body, declarationStart, isUnderscore, marked: false });
  }

  return { candidates, hasUnderscoreVariant };
}

function markParseOnlyInventoryCandidates(
  source: string,
  candidates: ParseOnlyInventoryCandidate[],
  hasUnderscoreVariant: boolean,
): void {
  for (const candidate of candidates) {
    if (
      hasParseOnlyInventoryMarkerImmediatelyBefore(source, candidate.declarationStart) &&
      (!hasUnderscoreVariant || candidate.isUnderscore)
    ) {
      candidate.marked = true;
    }
  }
}

function resolveParseOnlyInventoryBody(
  candidates: ParseOnlyInventoryCandidate[],
  constantName: string,
  key: string,
): string {
  let firstUnmarked: ParseOnlyInventoryCandidate | undefined;
  let firstMarked: ParseOnlyInventoryCandidate | undefined;
  for (const candidate of candidates) {
    if (candidate.marked) {
      if (firstMarked === undefined) {
        firstMarked = candidate;
      }
    } else if (firstUnmarked === undefined) {
      firstUnmarked = candidate;
    }
  }

  if (firstMarked !== undefined) {
    if (firstUnmarked !== undefined && firstUnmarked.declarationStart < firstMarked.declarationStart) {
      throw new StructuralTestLocatorError(
        "inventory-binding",
        key,
        `unmarked ${constantName} would bind before marked inventory declaration`,
      );
    }
    return firstMarked.body;
  }
  if (firstUnmarked !== undefined) {
    throw new StructuralTestLocatorError(
      "inventory-binding",
      key,
      `parse-only inventory marker missing on ${constantName}`,
    );
  }
  throw new StructuralTestLocatorError("inventory-binding", key, `inventory constant ${constantName} not found`);
}

export function locateParseOnlyInventoryArrayBody(source: string, constantName: string, searchKey?: string): string {
  const key = searchKey ?? constantName;
  const pattern = new RegExp(`(?:export\\s+)?const\\s+_?${escapeRegExp(constantName)}\\s*(?::[^=]+)?=\\s*\\[`, "g");
  const { candidates, hasUnderscoreVariant } = collectParseOnlyInventoryCandidates(source, constantName, key, pattern);
  markParseOnlyInventoryCandidates(source, candidates, hasUnderscoreVariant);
  return resolveParseOnlyInventoryBody(candidates, constantName, key);
}

export function locateFrontmatterField(source: string, field: string, sourceLabel: string): string {
  const frontmatter = locateMarkerSlice({
    text: source,
    start: "---\n",
    end: "\n---\n",
    searchKey: `frontmatter in ${sourceLabel}`,
  });
  return locateMarkerSlice({
    text: frontmatter,
    pattern: new RegExp(`^${field}:\\s*(.+)$`, "m"),
    searchKey: `${field} in ${sourceLabel}`,
  }).trim();
}
