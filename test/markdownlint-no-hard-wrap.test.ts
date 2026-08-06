import { describe, expect, test } from "bun:test";
import markdownlint from "markdownlint";
import noHardWrapRule from "../scripts/markdownlint-no-hard-wrap-rule.ts";

const RULE_NAME = "no-hard-wrap";

function lintMarkdown(content: string, options?: { includeCustomRule?: boolean }): number[] {
  const includeCustomRule = options?.includeCustomRule ?? true;
  const result = markdownlint.sync({
    strings: { content },
    customRules: includeCustomRule ? [noHardWrapRule] : [],
    config: {
      default: false,
      [RULE_NAME]: true,
      MD041: false,
      MD047: false,
    },
  });
  return (result.content ?? []).filter((error) => error.ruleNames.includes(RULE_NAME)).map((error) => error.lineNumber);
}

describe("markdownlint no-hard-wrap rule", () => {
  test("flags an intra-paragraph soft line break", () => {
    // @mutate scripts/markdownlint-no-hard-wrap-rule.ts "if (child.type !== \"softbreak\"" -> "if (false"
    const violations = lintMarkdown("alpha beta\ncontinued prose");
    expect(violations).toEqual([1]);
  });

  test("flags an intra-list-item soft line break at the same marker indent", () => {
    const violations = lintMarkdown("- bullet prose\nwrapped tail");
    expect(violations).toEqual([1]);
  });

  test("exempts fenced code blocks", () => {
    const content = "```ts\nline one\nline two\n```";
    expect(lintMarkdown(content)).toEqual([]);
  });

  test("exempts tables", () => {
    const content = "| a | b |\n|---|---|\n| c\nd | e |";
    expect(lintMarkdown(content)).toEqual([]);
  });

  test("exempts block-level HTML blocks", () => {
    const content = "<div>\nblock\n</div>";
    expect(lintMarkdown(content)).toEqual([]);
  });

  test("exempts inline HTML tags within prose", () => {
    const content = "text with <b>inline</b> tag";
    expect(lintMarkdown(content)).toEqual([]);
  });

  test("exempts YAML front matter", () => {
    const content = "---\ntitle: sample\n---\n\nbody prose";
    const result = markdownlint.sync({
      strings: { content },
      customRules: [noHardWrapRule],
      config: {
        default: false,
        [RULE_NAME]: true,
        MD041: false,
        MD047: false,
      },
      frontMatter: /(^---\s*$[\s\S]*?^---\s*$)(\r\n|\r|\n|$)/,
    });
    const violations = (result.content ?? [])
      .filter((error) => error.ruleNames.includes(RULE_NAME))
      .map((error) => error.lineNumber);
    expect(violations).toEqual([]);
  });

  test("exempts explicit hard breaks with two trailing spaces", () => {
    const violations = lintMarkdown("line one  \nline two");
    expect(violations).toEqual([]);
  });

  test("exempts explicit hard breaks with trailing backslash", () => {
    const violations = lintMarkdown("line one\\\nline two");
    expect(violations).toEqual([]);
  });

  test("exempts list-item continuation lines with deeper indent", () => {
    const violations = lintMarkdown("- first line\n  continuation line");
    expect(violations).toEqual([]);
  });

  test("exempts reference-link definition blocks", () => {
    const violations = lintMarkdown("[ref]: https://example.com\n  title");
    expect(violations).toEqual([]);
  });

  test("fails against a fixture config omitting the no-hard-wrap customRules entry", () => {
    const violations = lintMarkdown("alpha beta\ncontinued prose", { includeCustomRule: false });
    expect(violations).toEqual([]);
  });
});
