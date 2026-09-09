export type StructuralTestLocatorKind = "marker-slice" | "symbol-slice" | "discovered-file";

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
