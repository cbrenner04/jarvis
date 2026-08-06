import { describe, expect, test } from "bun:test";
import { reflowMarkdownContent } from "../scripts/reflow-markdown.ts";

const WRAPPED_PARAGRAPH = "alpha beta\ncontinued prose";
const WRAPPED_LIST = "- bullet prose\nwrapped tail";

describe("reflow markdown", () => {
  test("reflows a wrapped paragraph to one physical line", () => {
    // @mutate scripts/reflow-markdown.ts "const joined = `${current.trimEnd()} ${next.trimStart()}`;" -> "const joined = current;"
    expect(reflowMarkdownContent(WRAPPED_PARAGRAPH)).toBe("alpha beta continued prose");
  });

  test("reflows a wrapped list item to one physical line", () => {
    expect(reflowMarkdownContent(WRAPPED_LIST)).toBe("- bullet prose wrapped tail");
  });

  test("preserves fenced code blocks byte-identically", () => {
    const content = "```ts\nline one\nline two\n```";
    expect(reflowMarkdownContent(content)).toBe(content);
  });

  test("preserves tables byte-identically", () => {
    const content = "| a | b |\n|---|---|\n| c\nd | e |";
    expect(reflowMarkdownContent(content)).toBe(content);
  });

  test("preserves block-level HTML blocks byte-identically", () => {
    const content = "<div>\nblock\n</div>";
    expect(reflowMarkdownContent(content)).toBe(content);
  });

  test("preserves inline HTML tags within prose byte-identically", () => {
    const content = "text with <b>inline</b> tag";
    expect(reflowMarkdownContent(content)).toBe(content);
  });

  test("preserves YAML front matter byte-identically", () => {
    const content = "---\ntitle: sample\n---\n\nbody prose";
    expect(reflowMarkdownContent(content)).toBe(content);
  });

  test("preserves explicit hard breaks with two trailing spaces byte-identically", () => {
    const content = "line one  \nline two";
    expect(reflowMarkdownContent(content)).toBe(content);
  });

  test("preserves explicit hard breaks with trailing backslash byte-identically", () => {
    const content = "line one\\\nline two";
    expect(reflowMarkdownContent(content)).toBe(content);
  });

  test("preserves list-item continuation lines byte-identically", () => {
    const content = "- first line\n  continuation line";
    expect(reflowMarkdownContent(content)).toBe(content);
  });

  test("preserves reference-link definition blocks byte-identically", () => {
    const content = "[ref]: https://example.com\n  title";
    expect(reflowMarkdownContent(content)).toBe(content);
  });

  test("is idempotent on re-run", () => {
    const once = reflowMarkdownContent(WRAPPED_PARAGRAPH);
    expect(reflowMarkdownContent(once)).toBe(once);
  });

  test("fails against pre-fix wrapped fixtures when reflow is absent", () => {
    expect(reflowMarkdownContent(WRAPPED_PARAGRAPH)).not.toBe(WRAPPED_PARAGRAPH);
  });

  test("fails against pre-fix wrapped fixtures when reflow is a no-op", () => {
    const noOp = (content: string) => content;
    expect(noOp(WRAPPED_PARAGRAPH)).toBe(WRAPPED_PARAGRAPH);
    expect(reflowMarkdownContent(WRAPPED_PARAGRAPH)).not.toBe(WRAPPED_PARAGRAPH);
  });
});
