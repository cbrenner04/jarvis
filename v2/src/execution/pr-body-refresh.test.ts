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
  test("composes header + preserved narrative + footer when markers and footer present", async () => {
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
    await refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      fetchPrBody: async () => currentBody,
      writePrBody: async (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: async () => "- abc Foo \u2014 Agent X\n\nWritten by Agent X through Jarvis.",
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

  test("omits footer separator when renderFooter returns empty string", async () => {
    let writtenBody = "";
    await refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      fetchPrBody: async () => "",
      writePrBody: async (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: async () => "",
    });

    expect(writtenBody).toBe("Spec: v2/spec/test/index.md");
    expect(writtenBody).not.toContain("---");
  });

  test("uses regenerated header without markers when narrative is absent", async () => {
    let writtenBody = "";
    await refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      fetchPrBody: async () => "Spec: old path",
      writePrBody: async (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: async () => "- abc Foo \u2014 Agent A\n\nWritten by Agent A through Jarvis.",
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

  test("passes branch and cwd through to writer", async () => {
    let seenBranch = "";
    let seenCwd = "";
    await refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature-x",
      base: "main",
      cwd: "/tmp/worktree",
      fetchPrBody: async () => "",
      writePrBody: async (branch, _body, cwd) => {
        seenBranch = branch;
        seenCwd = cwd;
      },
      renderFooter: async () => "",
    });

    expect(seenBranch).toBe("feature-x");
    expect(seenCwd).toBe("/tmp/worktree");
  });

  test("surfaces gh failures as thrown errors", async () => {
    await expect(
      refreshPrBody({
        specPath: "v2/spec/test/index.md",
        branch: "feature",
        base: "main",
        cwd: "/tmp/worktree",
        fetchPrBody: async () => "",
        writePrBody: async () => {
          throw new Error("gh pr edit failed");
        },
        renderFooter: async () => "",
      }),
    ).rejects.toThrow("gh pr edit failed");
  });

  test("surfaces rejected attribution git read as thrown error", async () => {
    await expect(
      refreshPrBody({
        specPath: "v2/spec/test/index.md",
        branch: "feature",
        base: "main",
        cwd: "/tmp/worktree",
        fetchPrBody: async () => "",
        writePrBody: async () => {},
        git: async () => {
          throw new Error("git log failed");
        },
      }),
    ).rejects.toThrow("git log failed");
  });

  test("renders summary between Spec line and narrative markers", async () => {
    const humanEditedNarrative = "Human edited narrative";
    const summary = "## Summary\n\nLanded intent and spec checklist.";
    const currentBody = ["Spec: stale", "", NARRATIVE_START_MARKER, humanEditedNarrative, NARRATIVE_END_MARKER].join(
      "\n",
    );
    let writtenBody = "";
    await refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      bodySummary: summary,
      fetchPrBody: async () => currentBody,
      writePrBody: async (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: async () => "",
    });

    expect(writtenBody).toBe(
      [
        "Spec: v2/spec/test/index.md",
        "",
        summary,
        "",
        NARRATIVE_START_MARKER,
        humanEditedNarrative,
        NARRATIVE_END_MARKER,
      ].join("\n"),
    );
  });

  test("re-refresh with the same summary is byte-identical", async () => {
    const summary = "## Summary\n\nWhat landed.";
    const baseInput = {
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      bodySummary: summary,
      renderFooter: async () => "- abc Foo \u2014 Agent A\n\nWritten by Agent A through Jarvis.",
    };
    let storedBody = "";
    await refreshPrBody({
      ...baseInput,
      fetchPrBody: async () => "",
      writePrBody: async (_branch, body) => {
        storedBody = body;
      },
    });

    let secondWrittenBody = "";
    await refreshPrBody({
      ...baseInput,
      fetchPrBody: async () => storedBody,
      writePrBody: async (_branch, body) => {
        secondWrittenBody = body;
      },
    });

    expect(secondWrittenBody).toBe(storedBody);
  });

  test("refresh with a different summary replaces the prior block", async () => {
    const firstSummary = "## Summary\n\nFirst version.";
    const secondSummary = "## Summary\n\nSecond version.";
    const baseInput = {
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      renderFooter: async () => "",
    };
    let storedBody = "";
    await refreshPrBody({
      ...baseInput,
      bodySummary: firstSummary,
      fetchPrBody: async () => "",
      writePrBody: async (_branch, body) => {
        storedBody = body;
      },
    });

    let secondWrittenBody = "";
    await refreshPrBody({
      ...baseInput,
      bodySummary: secondSummary,
      fetchPrBody: async () => storedBody,
      writePrBody: async (_branch, body) => {
        secondWrittenBody = body;
      },
    });

    expect(secondWrittenBody).toContain(secondSummary);
    expect(secondWrittenBody).not.toContain(firstSummary);
    expect(secondWrittenBody).toBe(`Spec: v2/spec/test/index.md\n\n${secondSummary}`);
  });

  test("emits supplied narrative in marker block when fetched body has no narrative", async () => {
    const suppliedNarrative = "Authored narrative\nMultiple lines";
    let writtenBody = "";
    await refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      narrative: suppliedNarrative,
      fetchPrBody: async () => "Spec: old spec",
      writePrBody: async (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: async () => "",
    });

    expect(writtenBody).toContain(NARRATIVE_START_MARKER);
    expect(writtenBody).toContain(NARRATIVE_END_MARKER);
    expect(extractNarrative(writtenBody)).toBe(suppliedNarrative);
    expect(writtenBody).toBe(
      ["Spec: v2/spec/test/index.md", "", NARRATIVE_START_MARKER, suppliedNarrative, NARRATIVE_END_MARKER].join("\n"),
    );
  });

  test("preserves extracted narrative even when a different narrative is supplied", async () => {
    const existingNarrative = "Human edited narrative";
    const suppliedNarrative = "Ignored supplied narrative";
    const currentBody = ["Spec: old", "", NARRATIVE_START_MARKER, existingNarrative, NARRATIVE_END_MARKER].join("\n");

    let writtenBody = "";
    await refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      narrative: suppliedNarrative,
      fetchPrBody: async () => currentBody,
      writePrBody: async (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: async () => "",
    });

    expect(extractNarrative(writtenBody)).toBe(existingNarrative);
    expect(writtenBody).not.toContain(suppliedNarrative);
  });

  test("does not emit markers when neither extracted nor supplied narrative exists", async () => {
    let writtenBody = "";
    await refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      fetchPrBody: async () => "Spec: old",
      writePrBody: async (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: async () => "",
    });

    expect(writtenBody).not.toContain(NARRATIVE_START_MARKER);
    expect(writtenBody).not.toContain(NARRATIVE_END_MARKER);
    expect(writtenBody).toBe("Spec: v2/spec/test/index.md");
  });

  test("treats empty or whitespace-only supplied narrative as absent", async () => {
    let writtenBody1 = "";
    await refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      narrative: "   ",
      fetchPrBody: async () => "Spec: old",
      writePrBody: async (_branch, body) => {
        writtenBody1 = body;
      },
      renderFooter: async () => "",
    });

    let writtenBody2 = "";
    await refreshPrBody({
      specPath: "v2/spec/test/index.md",
      branch: "feature",
      base: "main",
      cwd: "/tmp/worktree",
      narrative: "",
      fetchPrBody: async () => "Spec: old",
      writePrBody: async (_branch, body) => {
        writtenBody2 = body;
      },
      renderFooter: async () => "",
    });

    expect(writtenBody1).not.toContain(NARRATIVE_START_MARKER);
    expect(writtenBody2).not.toContain(NARRATIVE_START_MARKER);
  });
});
