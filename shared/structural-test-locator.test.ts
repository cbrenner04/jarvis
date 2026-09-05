import { describe, expect, test } from "bun:test";
import {
  locateDiscoveredFile,
  locateMarkerSlice,
  locateSymbolSlice,
  type StructuralTestLocatorKind,
  StructuralTestLocatorError,
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
      "shared/prompts/plan-draft.ts": "export function renderPlanDraft() {}",
    };
    expect(locateDiscoveredFile(discovered, "shared/prompts/plan-draft.ts")).toContain("renderPlanDraft");

    const absent = silentDiscoveredFile(discovered, "shared/prompts/missing.ts");
    expect(absent).toBe("");
    expect(absent).not.toContain("never-here");

    expectLocatorMiss(
      () => locateDiscoveredFile(discovered, "shared/prompts/missing.ts"),
      "discovered-file",
      "shared/prompts/missing.ts",
    );
  });
});
