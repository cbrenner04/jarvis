import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPrBody,
  extractNarrative,
  maybeMarkReady,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
  updatePrBody,
} from "../../../src/modes/patch/pr.ts";

let dir: string;
let indexPath: string;

function gitSetup(): void {
  execSync("git init -q", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", {
    cwd: dir,
    stdio: "pipe",
  });
  execSync("git config user.name 'Test User'", { cwd: dir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -q -b main", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -q -m 'seed'", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -q -b feature", { cwd: dir, stdio: "pipe" });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-pr-test-"));
  indexPath = join(dir, "spec", "index.md");
  // Create spec directory
  execSync("mkdir -p spec", { cwd: dir, stdio: "pipe" });
  gitSetup();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildPrBody", () => {
  test("renders header with H1, progress, and verbatim subspec checklist", () => {
    writeFileSync(
      indexPath,
      [
        "# Big Feature",
        "",
        "- [x] [00 - first](./00-first.md)",
        "- [ ] [01 - second](./01-second.md)",
        "- [ ] [02 - third](./02-third.md)",
        "",
      ].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toBe(
      [
        "# Big Feature",
        "",
        "## Progress",
        "",
        "1 of 3 subspecs complete",
        "",
        "## Subspecs",
        "",
        "- [x] [00 - first](./00-first.md)",
        "- [ ] [01 - second](./01-second.md)",
        "- [ ] [02 - third](./02-third.md)",
      ].join("\n"),
    );
  });

  test("excludes non-.md linked items from the checklist and progress count", () => {
    writeFileSync(
      indexPath,
      [
        "# Spec",
        "",
        "- [x] [00 - md](./00-md.md)",
        "- [ ] [link](https://example.com)",
        "",
      ].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toContain("1 of 1 subspecs complete");
    expect(body).toContain("- [x] [00 - md](./00-md.md)");
    expect(body).not.toContain("https://example.com");
  });

  test("includes narrative bracketed by markers when narrative is non-null", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const body = buildPrBody({
      indexPath,
      narrative: "Some narrative content.",
    });
    expect(body).toContain(
      `${NARRATIVE_START_MARKER}\nSome narrative content.\n${NARRATIVE_END_MARKER}`,
    );
  });

  test("omits narrative markers when narrative is null", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).not.toContain(NARRATIVE_START_MARKER);
    expect(body).not.toContain(NARRATIVE_END_MARKER);
  });

  test("renders header with no H1 when index has none", () => {
    writeFileSync(indexPath, "- [ ] [00 - one](./00-one.md)\n");
    const body = buildPrBody({ indexPath, narrative: null });
    expect(body.startsWith("## Progress\n")).toBe(true);
    expect(body).toContain("0 of 1 subspecs complete");
  });
});

describe("extractNarrative", () => {
  test("returns trimmed text between markers when both are present", () => {
    const body = [
      "# Header",
      "",
      NARRATIVE_START_MARKER,
      "",
      "  hello world  ",
      "",
      NARRATIVE_END_MARKER,
      "",
      "footer",
    ].join("\n");
    expect(extractNarrative(body)).toBe("hello world");
  });

  test("returns null when start marker is missing", () => {
    const body = `body\n${NARRATIVE_END_MARKER}\n`;
    expect(extractNarrative(body)).toBeNull();
  });

  test("returns null when end marker is missing", () => {
    const body = `${NARRATIVE_START_MARKER}\ncontent\n`;
    expect(extractNarrative(body)).toBeNull();
  });

  test("returns null when both markers are missing", () => {
    expect(extractNarrative("just a body")).toBeNull();
  });

  test("trims surrounding whitespace from extracted content", () => {
    const body = `${NARRATIVE_START_MARKER}\n\n\nbody text\n\n\n${NARRATIVE_END_MARKER}`;
    expect(extractNarrative(body)).toBe("body text");
  });
});

describe("updatePrBody", () => {
  test("composes header + preserved narrative + footer when markers and footer present", () => {
    writeFileSync(
      indexPath,
      [
        "# Spec",
        "",
        "- [x] [00 - one](./00-one.md)",
        "- [ ] [01 - two](./01-two.md)",
        "",
      ].join("\n"),
    );
    const currentBody = [
      "# stale header",
      "",
      NARRATIVE_START_MARKER,
      "preserved narrative",
      NARRATIVE_END_MARKER,
      "",
      "stale footer",
    ].join("\n");

    let writtenBody = "";
    updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => currentBody,
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () =>
        "- abc Foo \u2014 Agent X\n\nWritten by Agent X through Jarvis.",
    });

    expect(writtenBody).toContain("# Spec");
    expect(writtenBody).toContain("1 of 2 subspecs complete");
    expect(writtenBody).toContain(
      `${NARRATIVE_START_MARKER}\npreserved narrative\n${NARRATIVE_END_MARKER}`,
    );
    expect(writtenBody).toContain(
      "\n\n---\n\n- abc Foo \u2014 Agent X\n\nWritten by Agent X through Jarvis.",
    );
  });

  test("omits narrative section when markers missing in current body", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    let writtenBody = "";
    updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => "no markers here",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
    });

    expect(writtenBody).not.toContain(NARRATIVE_START_MARKER);
    expect(writtenBody).not.toContain(NARRATIVE_END_MARKER);
  });

  test("omits footer separator when renderFooter returns empty string", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    let writtenBody = "";
    updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => "",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
    });

    expect(writtenBody).not.toContain("---");
  });

  test("passes branch and cwd through to writer", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    let seenBranch = "";
    let seenCwd = "";
    updatePrBody({
      indexPath,
      branch: "feature-x",
      base: "main",
      cwd: dir,
      fetchPrBody: () => "",
      writePrBody: (branch, _body, cwd) => {
        seenBranch = branch;
        seenCwd = cwd;
      },
      renderFooter: () => "",
    });

    expect(seenBranch).toBe("feature-x");
    expect(seenCwd).toBe(dir);
  });

  test("surfaces gh failures as thrown errors", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    expect(() =>
      updatePrBody({
        indexPath,
        branch: "feature",
        base: "main",
        cwd: dir,
        fetchPrBody: () => "",
        writePrBody: () => {
          throw new Error("gh pr edit failed");
        },
        renderFooter: () => "",
      }),
    ).toThrow("gh pr edit failed");
  });
});

describe("maybeMarkReady", () => {
  test("returns early when subspecs are not complete", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => true,
      }),
    ).not.toThrow();
  });

  test("calls markReady when all subspecs complete", () => {
    writeFileSync(
      indexPath,
      "# Spec\n\n- [x] [00 - one](./00-one.md)\n- [x] [01 - two](./01-two.md)\n",
    );

    let markReadyCalled = false;
    let markReadyBranch = "";
    let markReadyCwd = "";

    expect(() => {
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => true,
        markReady: (branch, cwd) => {
          markReadyCalled = true;
          markReadyBranch = branch;
          markReadyCwd = cwd;
        },
      });
    }).not.toThrow();

    expect(markReadyCalled).toBe(true);
    expect(markReadyBranch).toBe("feature");
    expect(markReadyCwd).toBe(dir);
  });

  test("propagates errors from markReady", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");

    const multilineError =
      "bun run ready failed:\nsrc/foo.ts(1,1): error TS2345: ...\nFound 1 error.";
    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => true,
        markReady: () => {
          throw new Error(multilineError);
        },
      }),
    ).toThrow(multilineError);
  });

  test("throws when no PR exists for the branch", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");

    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => false,
      }),
    ).toThrow("cannot mark PR ready: no PR found");
  });

  test("(a) runReady does not dirty tree -> commitCheckFix not called, ghPrReady called", () => {
    writeFileSync(
      indexPath,
      "# Spec\n\n- [x] [00 - one](./00-one.md)\n- [x] [01 - two](./01-two.md)\n",
    );
    // Commit the spec file to have a clean tree
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'add spec'", { cwd: dir, stdio: "pipe" });

    let runReadyCalled = false;
    let commitCheckFixCalled = false;
    let ghPrReadyCalled = false;
    let ghPrReadyBranch = "";

    maybeMarkReady({
      indexPath,
      cwd: dir,
      checkPrExists: () => true,
      agentLabel: "test-agent",
      runReady: () => {
        runReadyCalled = true;
        // Don't dirty the tree
      },
      commitCheckFix: () => {
        commitCheckFixCalled = true;
      },
      ghPrReady: (branch) => {
        ghPrReadyCalled = true;
        ghPrReadyBranch = branch;
      },
    });

    expect(runReadyCalled).toBe(true);
    expect(commitCheckFixCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(true);
    expect(ghPrReadyBranch).toBe("feature");
  });

  test("(b) runReady dirties tree -> commitCheckFix called with correct args, then ghPrReady", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    // Commit the spec file to have a clean baseline
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'add spec'", { cwd: dir, stdio: "pipe" });

    let runReadyCalled = false;
    let commitCheckFixCalled = false;
    let commitCheckFixCwd = "";
    let commitCheckFixAgentLabel = "";
    let ghPrReadyCalled = false;

    maybeMarkReady({
      indexPath,
      cwd: dir,
      checkPrExists: () => true,
      agentLabel: "my-agent",
      runReady: () => {
        runReadyCalled = true;
        // Dirty the tree by creating an untracked file
        execSync("echo dirty > dirty.txt", { cwd: dir, stdio: "pipe" });
      },
      commitCheckFix: (cwd, agentLabel) => {
        commitCheckFixCalled = true;
        commitCheckFixCwd = cwd;
        commitCheckFixAgentLabel = agentLabel;
        // Clean up the dirty file
        execSync("git add -A", { cwd, stdio: "pipe" });
        execSync("git commit -q -m 'clean'", { cwd, stdio: "pipe" });
      },
      ghPrReady: () => {
        ghPrReadyCalled = true;
      },
    });

    expect(runReadyCalled).toBe(true);
    expect(commitCheckFixCalled).toBe(true);
    expect(commitCheckFixCwd).toBe(dir);
    expect(commitCheckFixAgentLabel).toBe("my-agent");
    expect(ghPrReadyCalled).toBe(true);
  });

  test("(c) runReady throws -> commitCheckFix not called, ghPrReady not called, error propagates", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    // Commit the spec file to have a clean baseline
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'add spec'", { cwd: dir, stdio: "pipe" });

    let commitCheckFixCalled = false;
    let ghPrReadyCalled = false;

    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => true,
        runReady: () => {
          throw new Error("runReady failed");
        },
        commitCheckFix: () => {
          commitCheckFixCalled = true;
        },
        ghPrReady: () => {
          ghPrReadyCalled = true;
        },
      }),
    ).toThrow("runReady failed");

    expect(commitCheckFixCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(false);
  });

  test("(d) commitCheckFix throws -> ghPrReady not called, error propagates", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    // Commit the spec file to have a clean baseline
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'add spec'", { cwd: dir, stdio: "pipe" });

    let ghPrReadyCalled = false;

    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => true,
        runReady: () => {
          // Dirty the tree
          execSync("echo dirty > dirty.txt", { cwd: dir, stdio: "pipe" });
        },
        commitCheckFix: () => {
          throw new Error("commitCheckFix failed");
        },
        ghPrReady: () => {
          ghPrReadyCalled = true;
        },
      }),
    ).toThrow("commitCheckFix failed");

    expect(ghPrReadyCalled).toBe(false);
  });
});
