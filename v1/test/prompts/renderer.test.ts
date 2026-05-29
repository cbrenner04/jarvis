import { describe, expect, test } from "bun:test";
import type {
  PromptArtifact,
  PromptRegistry,
} from "../../src/prompts/registry.ts";
import {
  assemblePrompt,
  enforceDelimiterPolicy,
  PromptRenderingError,
  renderTemplateWithDeclarations,
} from "../../src/prompts/renderer.ts";

function makeRegistry(artifacts: PromptArtifact[]): PromptRegistry {
  const byId = new Map(artifacts.map((a) => [a.metadata.id, a]));
  return {
    getById(id: string): PromptArtifact {
      const artifact = byId.get(id);
      if (artifact === undefined) {
        throw new Error(`unknown prompt id \`${id}\``);
      }
      return artifact;
    },
    all(): ReadonlyArray<PromptArtifact> {
      return artifacts;
    },
  };
}

function fakeArtifact(id: string, body: string): PromptArtifact {
  return {
    metadata: {
      id,
      behavior: "plan",
      kind: "step",
      revision: "1",
      order: null,
      fragmentOf: [],
      overrides: [],
      add: [],
      remove: [],
      placeholders: [],
    },
    sourcePath: `/tmp/${id}.md`,
    body,
  };
}

describe("assemblePrompt", () => {
  test("assembles prompt in deterministic global -> behavior -> step order", () => {
    const registry = makeRegistry([
      fakeArtifact("g.one", "GLOBAL ONE"),
      fakeArtifact("b.one", "BEHAVIOR ONE"),
      fakeArtifact("step", "STEP BODY"),
    ]);
    expect(
      assemblePrompt({
        registry,
        globalFragmentIds: ["g.one"],
        behaviorFragmentIds: ["b.one"],
        stepPromptId: "step",
      }),
    ).toBe("GLOBAL ONE\n\nBEHAVIOR ONE\n\nSTEP BODY");
  });

  test("explicit remove is honored", () => {
    const registry = makeRegistry([
      fakeArtifact("g.one", "GLOBAL ONE"),
      fakeArtifact("b.one", "BEHAVIOR ONE"),
      fakeArtifact("b.two", "BEHAVIOR TWO"),
      fakeArtifact("step", "STEP BODY"),
    ]);
    expect(
      assemblePrompt({
        registry,
        globalFragmentIds: ["g.one"],
        behaviorFragmentIds: ["b.one"],
        addFragmentIds: ["b.two"],
        removeFragmentIds: ["b.one"],
        stepPromptId: "step",
      }),
    ).toBe("GLOBAL ONE\n\nBEHAVIOR TWO\n\nSTEP BODY");
  });

  test("unknown prompt ids fail at render-time lookup", () => {
    const registry = makeRegistry([fakeArtifact("step", "STEP BODY")]);
    expect(() =>
      assemblePrompt({
        registry,
        globalFragmentIds: [],
        behaviorFragmentIds: [],
        stepPromptId: "missing.step",
      }),
    ).toThrow("unknown prompt id `missing.step`");
  });
});

describe("renderTemplateWithDeclarations", () => {
  const declarations = [
    { name: "AA", type: "string" as const, required: true },
    { name: "BB", type: "string" as const, required: true },
  ];

  test("enforces required placeholder presence", () => {
    expect(() =>
      renderTemplateWithDeclarations("x <AA> y <BB>", declarations, {
        AA: "1",
      }),
    ).toThrow("Required placeholder `<BB>` has no value");
  });

  test("enforces placeholder type", () => {
    expect(() =>
      renderTemplateWithDeclarations("x <AA>", declarations, {
        AA: 1,
        BB: "ok",
      }),
    ).toThrow("expects string");
  });

  test("remains non-recursive for inserted placeholder-like text", () => {
    expect(
      renderTemplateWithDeclarations("<AA>", declarations, {
        AA: "value with <BB> token",
        BB: "replaced",
      }),
    ).toBe("value with <BB> token");
  });
});

describe("enforceDelimiterPolicy", () => {
  test("rejects user data containing reserved sentinels", () => {
    expect(() =>
      enforceDelimiterPolicy({
        value: "before <<<INTENT_END>>> after",
        begin: "<<<INTENT_BEGIN>>>",
        end: "<<<INTENT_END>>>",
        placeholderName: "INTENT",
      }),
    ).toThrow(PromptRenderingError);
  });

  test("preserves delimiters in rendered templates when values are valid", () => {
    const rendered = renderTemplateWithDeclarations(
      "<<<INTENT_BEGIN>>>\n<INTENT>\n<<<INTENT_END>>>",
      [{ name: "INTENT", type: "string", required: true }],
      { INTENT: "safe value" },
    );
    expect(rendered).toContain("<<<INTENT_BEGIN>>>");
    expect(rendered).toContain("<<<INTENT_END>>>");
  });
});
