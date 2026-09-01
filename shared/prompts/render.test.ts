import { describe, expect, test } from "bun:test";
import {
  enforceDelimiterPolicy,
  PromptRenderingError,
  renderArtifactTemplate,
  renderTemplateWithDeclarations,
} from "./render.ts";
import type { PromptArtifact } from "./types.ts";

function expectRenderReason(fn: () => void, reason: PromptRenderingError["reason"]): void {
  try {
    fn();
    throw new Error("expected render to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(PromptRenderingError);
    expect((err as PromptRenderingError).reason).toBe(reason);
  }
}

function testArtifact(overrides: Partial<PromptArtifact["metadata"]> & { body: string }): PromptArtifact {
  return {
    sourcePath: "test.prompt.md",
    body: overrides.body,
    metadata: {
      id: "test.prompt",
      behavior: "test",
      kind: "step",
      revision: "1",
      order: null,
      fragmentOf: [],
      overrides: [],
      add: [],
      remove: [],
      placeholders: overrides.placeholders ?? [{ name: "AA", type: "string", required: true }],
      variants: overrides.variants ?? {},
      optionalSections: overrides.optionalSections ?? [],
    },
  };
}

describe("renderTemplateWithDeclarations", () => {
  const declarations = [
    { name: "AA", type: "string" as const, required: true },
    { name: "BB", type: "string" as const, required: true },
  ];

  test("enforces required placeholder presence", () => {
    const values = { AA: "1" };
    const template = "x <AA> y <BB>";
    expect(() => renderTemplateWithDeclarations(template, declarations, values)).toThrow(
      "Required placeholder `<BB>` has no value",
    );
    expect(() => renderTemplateWithDeclarations(template, declarations, values, "test.prompt")).toThrow(
      "Prompt `test.prompt`: Required placeholder `<BB>` has no value",
    );
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

describe("renderArtifactTemplate", () => {
  test("throws missing_template_anchor when variant substitution anchor is absent", () => {
    const artifact = testArtifact({
      body: "unchanged body",
      variants: {
        "flat-layout": [{ anchor: "<<<MISSING>>>", replacement: "replacement" }],
      },
    });
    expectRenderReason(
      () => renderArtifactTemplate(artifact, { AA: "value" }, { variant: "flat-layout" }),
      "missing_template_anchor",
    );
  });

  test("omits optional section when bound placeholder is empty", () => {
    const artifact = testArtifact({
      body: ["required <AA>", "## Optional", "<<<OPT_BEGIN>>>", "optional <BB>", "<<<OPT_END>>>", "tail"].join("\n"),
      placeholders: [
        { name: "AA", type: "string", required: true },
        { name: "BB", type: "string", required: false },
      ],
      optionalSections: [
        {
          header: "## Optional",
          begin: "<<<OPT_BEGIN>>>",
          end: "<<<OPT_END>>>",
          placeholder: "BB",
        },
      ],
    });
    expect(renderArtifactTemplate(artifact, { AA: "kept", BB: "" })).toBe("required kept\ntail");
  });

  test("throws unknown_variant when options.variant is absent from artifact variants", () => {
    const artifact = testArtifact({
      body: "body <AA>",
      variants: {
        "flat-layout": [{ anchor: "body", replacement: "layout" }],
      },
    });
    expectRenderReason(
      () => renderArtifactTemplate(artifact, { AA: "value" }, { variant: "nested-target-dir" }),
      "unknown_variant",
    );
  });

  test("throws missing_template_anchor when optional-section anchors drift", () => {
    const artifact = testArtifact({
      body: "## Optional\n<<<OPT_BEGIN>>>\noptional <BB>\n<<<OPT_END>>>",
      placeholders: [
        { name: "AA", type: "string", required: true },
        { name: "BB", type: "string", required: false },
      ],
      optionalSections: [
        {
          header: "## Missing header",
          begin: "<<<OPT_BEGIN>>>",
          end: "<<<OPT_END>>>",
          placeholder: "BB",
        },
      ],
    });
    expectRenderReason(() => renderArtifactTemplate(artifact, { AA: "value", BB: "" }), "missing_template_anchor");
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
