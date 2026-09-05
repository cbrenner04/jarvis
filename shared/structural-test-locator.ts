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

function throwLocatorError(kind: StructuralTestLocatorKind, searchKey: string): never {
  throw new StructuralTestLocatorError(kind, searchKey);
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
    // @mutate shared/structural-test-locator.ts "match === null" -> "match !== null"
    if (match === null) {
      throwLocatorError("marker-slice", input.searchKey ?? input.pattern.source);
    }
    const capture = match[1] ?? match[0];
    if (capture === undefined || capture === "") {
      throwLocatorError("marker-slice", input.searchKey ?? input.pattern.source);
    }
    return capture;
  }

  const startIndex = input.text.indexOf(input.start);
  // @mutate shared/structural-test-locator.ts "startIndex === -1" -> "startIndex !== -1"
  if (startIndex === -1) {
    throwLocatorError("marker-slice", input.searchKey ?? input.start);
  }
  const sliceStart = startIndex + input.start.length;
  const endIndex = input.text.indexOf(input.end, sliceStart);
  // @mutate shared/structural-test-locator.ts "endIndex === -1" -> "endIndex !== -1"
  if (endIndex === -1) {
    throwLocatorError("marker-slice", input.searchKey ?? input.end);
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
  // @mutate shared/structural-test-locator.ts "owner === undefined" -> "owner !== undefined"
  if (owner === undefined) {
    throwLocatorError("symbol-slice", input.searchKey ?? input.start);
  }
  const from = owner.indexOf(input.start);
  if (from === -1) {
    throwLocatorError("symbol-slice", input.searchKey ?? input.start);
  }
  const toIndex = owner.indexOf(input.end, from + input.start.length);
  // @mutate shared/structural-test-locator.ts "toIndex === -1" -> "toIndex !== -1"
  if (toIndex === -1) {
    throwLocatorError("symbol-slice", input.searchKey ?? input.end);
  }
  return owner.slice(from, toIndex);
}

export function locateDiscoveredFile(discovered: Readonly<Record<string, string>>, relativePath: string): string {
  const content = discovered[relativePath];
  // @mutate shared/structural-test-locator.ts "content === undefined" -> "content !== undefined"
  if (content === undefined) {
    throwLocatorError("discovered-file", relativePath);
  }
  return content;
}
