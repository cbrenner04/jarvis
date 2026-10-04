import { describe, expect, test } from "bun:test";
import {
  locateDiscoveredFile,
  locateMarkerSlice,
  locateParseOnlyInventoryArrayBody,
  locateSymbolSlice,
  PARSE_ONLY_INVENTORY_MARKER_COMMENT,
  type StructuralTestLocatorKind,
} from "./structural-test-locator.ts";

function silentMarkerSlice(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  if (startIndex === -1) return "";
  const sliceStart = startIndex + start.length;
  const endIndex = text.indexOf(end, sliceStart);
  if (endIndex === -1) return "";
  return text.slice(sliceStart, endIndex);
}

function silentSymbolSlice(candidates: readonly string[], start: string, end: string): string {
  const owner = candidates.find((text) => text.includes(start));
  if (owner === undefined) return "";
  const from = owner.indexOf(start);
  if (from === -1) return "";
  const toIndex = owner.indexOf(end, from + start.length);
  if (toIndex === -1) return "";
  return owner.slice(from, toIndex);
}

function silentDiscoveredFile(discovered: Readonly<Record<string, string>>, relativePath: string): string {
  return discovered[relativePath] ?? "";
}

function silentUnprefixedInventoryBody(source: string, constantName: string): string {
  const match = source.match(
    new RegExp(`(?:export\\s+)?const\\s+${constantName}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\];`),
  );
  return match?.[1] ?? "";
}

function expectLocatorMiss(fn: () => unknown, kind: StructuralTestLocatorKind, searchKey: string): void {
  try {
    fn();
    expect.unreachable();
  } catch (error) {
    expect(error).toMatchObject({ kind, searchKey });
  }
}

describe("structural test locators", () => {
  test("marker-slice fails loudly when bounds are absent", () => {
    const text = "alpha <<<START>>> body <<<END>>> omega";
    expect(locateMarkerSlice({ text, start: "<<<START>>>", end: "<<<END>>>" })).toBe(" body ");
    expect(locateMarkerSlice({ text, pattern: /<<<START>>>\s*(.*?)\s*<<<END>>>/s })).toBe("body");

    const absentStart = silentMarkerSlice(text, "<<<MISSING>>>", "<<<END>>>");
    expect(absentStart).toBe("");
    expect(absentStart).not.toContain("never-here");
    const absentEnd = silentMarkerSlice(text, "<<<START>>>", "<<<MISSING>>>");
    expect(absentEnd).toBe("");
    expect(absentEnd).not.toContain("never-here");

    expectLocatorMiss(
      () => locateMarkerSlice({ text, start: "<<<MISSING>>>", end: "<<<END>>>" }),
      "marker-slice",
      "<<<MISSING>>>",
    );
    expectLocatorMiss(
      () => locateMarkerSlice({ text, start: "<<<START>>>", end: "<<<MISSING>>>" }),
      "marker-slice",
      "<<<MISSING>>>",
    );
    expectLocatorMiss(() => locateMarkerSlice({ text, pattern: /<<<MISSING>>>/ }), "marker-slice", "<<<MISSING>>>");
  });

  test("symbol-slice fails loudly when the start anchor is absent", () => {
    const candidates = [
      "const keep = 1;",
      "const handleWorkflowStart = async () => {\n  return admitWorkflowStart({});\n}\nconst handleWriteLoopStart = () => {",
    ];
    const slice = locateSymbolSlice({
      candidates,
      start: "const handleWorkflowStart",
      end: "const handleWriteLoopStart",
    });
    expect(slice).toContain("return admitWorkflowStart");

    const absent = silentSymbolSlice(candidates, "const missingAnchor", "const handleWriteLoopStart");
    expect(absent).toBe("");
    expect(absent).not.toContain("never-here");

    expectLocatorMiss(
      () =>
        locateSymbolSlice({
          candidates,
          start: "const missingAnchor",
          end: "const handleWriteLoopStart",
        }),
      "symbol-slice",
      "const missingAnchor",
    );
  });

  test("discovered-file fails loudly when the path is missing", () => {
    const discovered = {
      "src/shared/prompts/plan-draft.ts": "export function renderPlanDraft() {}",
    };
    expect(locateDiscoveredFile(discovered, "src/shared/prompts/plan-draft.ts")).toContain("renderPlanDraft");

    const absent = silentDiscoveredFile(discovered, "src/shared/prompts/missing.ts");
    expect(absent).toBe("");
    expect(absent).not.toContain("never-here");

    expectLocatorMiss(
      () => locateDiscoveredFile(discovered, "src/shared/prompts/missing.ts"),
      "discovered-file",
      "src/shared/prompts/missing.ts",
    );
  });

  test("parse-only inventory binds marked module const, not later unprefixed fixture", () => {
    const constantName = "MODULE_INVENTORY_ANCHORS";
    const source = [
      PARSE_ONLY_INVENTORY_MARKER_COMMENT,
      `const _${constantName}: { id: string }[] = [`,
      '  { id: "module-inventory" },',
      "];",
      "",
      `const ${constantName} = [`,
      '  { id: "fixture-inventory" },',
      "];",
    ].join("\n");

    const contrastBody = silentUnprefixedInventoryBody(source, constantName);
    expect(contrastBody).toContain("fixture-inventory");
    expect(contrastBody).not.toContain("module-inventory");

    const bound = locateParseOnlyInventoryArrayBody(source, constantName);
    expect(bound).toContain("module-inventory");
    expect(bound).not.toContain("fixture-inventory");
  });

  test("parse-only inventory requires marker on the named declaration", () => {
    const constantName = "UNMARKED_INVENTORY";
    const source = [`const ${constantName} = [`, '  { id: "only" },', "];"].join("\n");

    expect(() => locateParseOnlyInventoryArrayBody(source, constantName)).toThrow(
      `parse-only inventory marker missing on ${constantName}`,
    );
  });

  test("parse-only inventory distinguishes missing marker from missing constant", () => {
    const constantName = "UNMARKED_INVENTORY";
    const unmarkedSource = [`const ${constantName} = [`, '  { id: "only" },', "];"].join("\n");

    expect(() => locateParseOnlyInventoryArrayBody(unmarkedSource, constantName)).toThrow(
      `parse-only inventory marker missing on ${constantName}`,
    );
    expect(() => locateParseOnlyInventoryArrayBody("const OTHER = [];", constantName)).toThrow(
      `inventory constant ${constantName} not found`,
    );
  });

  test("parse-only inventory tolerates optional leading underscore on constant name", () => {
    const constantName = "PREFIXED_INVENTORY";
    const prefixedSource = [
      PARSE_ONLY_INVENTORY_MARKER_COMMENT,
      `const _${constantName} = [`,
      '  { id: "underscored" },',
      "];",
    ].join("\n");
    const unprefixedSource = [
      PARSE_ONLY_INVENTORY_MARKER_COMMENT,
      `const ${constantName} = [`,
      '  { id: "plain" },',
      "];",
    ].join("\n");

    expect(locateParseOnlyInventoryArrayBody(prefixedSource, constantName)).toContain("underscored");
    expect(locateParseOnlyInventoryArrayBody(unprefixedSource, constantName)).toContain("plain");

    const unprefixedOnly = silentUnprefixedInventoryBody(prefixedSource, constantName);
    expect(unprefixedOnly).toBe("");
    expect(unprefixedOnly).not.toContain("underscored");
  });

  test("parse-only inventory throws on fixture binding that absent-only guards accept", () => {
    const constantName = "FIXTURE_ONLY_INVENTORY";
    const source = [`const ${constantName} = [`, '  { id: "fixture-only" },', "];"].join("\n");

    const silentBody = silentUnprefixedInventoryBody(source, constantName);
    expect(silentBody).toContain("fixture-only");

    expect(() => locateParseOnlyInventoryArrayBody(source, constantName)).toThrow(
      `parse-only inventory marker missing on ${constantName}`,
    );
  });

  test("parse-only inventory throws when same-shaped unprefixed fixture precedes a different named inventory", () => {
    const constantName = "REQUESTED_INVENTORY";
    const source = [
      `const ${constantName} = [`,
      '  { id: "wrong-first-match" },',
      "];",
      PARSE_ONLY_INVENTORY_MARKER_COMMENT,
      "const OTHER_INVENTORY = [",
      '  { id: "marked-other" },',
      "];",
    ].join("\n");

    expect(() => locateParseOnlyInventoryArrayBody(source, constantName)).toThrow(
      `parse-only inventory marker missing on ${constantName}`,
    );
  });

  test("parse-only inventory throws when unmarked same-name const precedes marked module inventory", () => {
    const constantName = "ORDERED_INVENTORY";
    const source = [
      `const ${constantName} = [`,
      '  { id: "first-match-fixture" },',
      "];",
      PARSE_ONLY_INVENTORY_MARKER_COMMENT,
      `const _${constantName} = [`,
      '  { id: "marked-module" },',
      "];",
    ].join("\n");

    const contrastBody = silentUnprefixedInventoryBody(source, constantName);
    expect(contrastBody).toContain("first-match-fixture");

    expect(() => locateParseOnlyInventoryArrayBody(source, constantName)).toThrow(
      `unmarked ${constantName} would bind before marked inventory declaration`,
    );
  });

  test("parse-only inventory does not treat one marker as marking a later unprefixed fixture before module const", () => {
    const constantName = "SHARED_MARKER_INVENTORY";
    const source = [
      PARSE_ONLY_INVENTORY_MARKER_COMMENT,
      `const ${constantName} = [`,
      '  { id: "fixture-under-marker" },',
      "];",
      `const _${constantName} = [`,
      '  { id: "module-without-marker" },',
      "];",
    ].join("\n");

    expect(() => locateParseOnlyInventoryArrayBody(source, constantName)).toThrow(
      `parse-only inventory marker missing on ${constantName}`,
    );
  });

  test("parse-only inventory resolves when only the marked module declaration exists", () => {
    const constantName = "MARKED_ONLY_INVENTORY";
    const source = [
      PARSE_ONLY_INVENTORY_MARKER_COMMENT,
      `const ${constantName} = [`,
      '  { id: "marked-only" },',
      "];",
    ].join("\n");

    expect(locateParseOnlyInventoryArrayBody(source, constantName)).toContain("marked-only");
  });
});
