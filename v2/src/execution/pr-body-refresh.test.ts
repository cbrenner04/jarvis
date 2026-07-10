import { describe, expect, test } from "bun:test";
import { extractNarrative, NARRATIVE_END_MARKER, NARRATIVE_START_MARKER, refreshPrBody } from "./pr-body-refresh.ts";

describe("extractNarrative", () => {
  test("returns null when markers are absent", () => {
    expect(extractNarrative("Spec: spec/foo/index.md")).toBeNull();
  });

  test("returns trimmed content between markers", () => {
    const body = ["Spec: stale", "", NARRATIVE_START_MARKER, "  Operator notes  ", NARRATIVE_END_MARKER].join("\n");
    expect(extractNarrative(body)).toBe("Operator notes");
  });
});

describe("refreshPrBody", () => {
  test("composes header + preserved narrative + footer when markers and footer present", () => {
    const humanEditedNarrative = "Human edited narrative\nMultiple lines here";
    const currentBody = [
      "Spec: stale",
      "",
      NARRATIVE_START_MARKER,
      humanEditedNarrative,
      NARRATIVE_END_MARKER,
      "",
      "stale footer",
    ].join("\n");

    let writtenBody = "";
    refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      fetchPrBody: () => currentBody,
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "- abc Foo \u2014 Agent X\n\nWritten by Agent X through Jarvis.",
    });

    expect(writtenBody).toBe(
      [
        "Spec: v2/spec/test/index.md",
        "",
        NARRATIVE_START_MARKER,
        humanEditedNarrative,
        NARRATIVE_END_MARKER,
        "",
        "---",
        "",
        "- abc Foo \u2014 Agent X",
        "",
        "Written by Agent X through Jarvis.",
      ].join("\n"),
    );
  });

  test("omits footer separator when renderFooter returns empty string", () => {
    let writtenBody = "";
    refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      fetchPrBody: () => "",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
    });

    expect(writtenBody).toBe("Spec: v2/spec/test/index.md");
    expect(writtenBody).not.toContain("---");
  });

  test("uses regenerated header without markers when narrative is absent", () => {
    let writtenBody = "";
    refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      fetchPrBody: () => "Spec: old path",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "- abc Foo \u2014 Agent A\n\nWritten by Agent A through Jarvis.",
    });

    expect(writtenBody).toBe(
      [
        "Spec: v2/spec/test/index.md",
        "",
        "---",
        "",
        "- abc Foo \u2014 Agent A",
        "",
        "Written by Agent A through Jarvis.",
      ].join("\n"),
    );
  });

  test("passes branch and cwd through to writer", () => {
    let seenBranch = "";
    let seenCwd = "";
    refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature-x",
      base: "main",
      cwd: "/tmp/worktree",
      fetchPrBody: () => "",
      writePrBody: (branch, _body, cwd) => {
        seenBranch = branch;
        seenCwd = cwd;
      },
      renderFooter: () => "",
    });

    expect(seenBranch).toBe("feature-x");
    expect(seenCwd).toBe("/tmp/worktree");
  });

  test("surfaces gh failures as thrown errors", () => {
    expect(() =>
      refreshPrBody({
        specPath: "v2/spec/test/index.md",
        branch: "feature",
        base: "main",
        cwd: "/tmp/worktree",
        fetchPrBody: () => "",
        writePrBody: () => {
          throw new Error("gh pr edit failed");
        },
        renderFooter: () => "",
      }),
    ).toThrow("gh pr edit failed");
  });
});
