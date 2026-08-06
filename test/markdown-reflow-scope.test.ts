import { describe, expect, test } from "bun:test";
import markdownlintConfig from "../.markdownlint-cli2.jsonc";
import { readMarkdownReflowScope } from "../scripts/reflow-markdown.ts";

describe("markdown reflow scope", () => {
  test("reflow:md uses the same globs as .markdownlint-cli2.jsonc", () => {
    expect(readMarkdownReflowScope().globs).toEqual(markdownlintConfig.globs);
  });

  test("reflow:md uses the same ignores as .markdownlint-cli2.jsonc", () => {
    expect(readMarkdownReflowScope().ignores).toEqual(markdownlintConfig.ignores);
  });
});
