import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listLandedIntentFiles } from "./intent-output.ts";
import { DEFAULT_PUBLICATION_TITLE, deriveIntentRunBodySummary } from "./intent-run-body-summary.ts";

describe("deriveIntentRunBodySummary", () => {
  test("renders subject and one bullet per intent file", () => {
    expect(
      deriveIntentRunBodySummary({
        creationTitle: "intent: seed-subject",
        intentFiles: ["beta.md", "alpha.md"],
      }),
    ).toBe("intent: seed-subject\n- alpha.md\n- beta.md");
  });

  test("suppresses the generic fallback creation title", () => {
    expect(
      deriveIntentRunBodySummary({
        creationTitle: DEFAULT_PUBLICATION_TITLE,
        intentFiles: ["one.md"],
      }),
    ).toBe("- one.md");
  });

  test("returns subject only when no intent files landed", () => {
    expect(
      deriveIntentRunBodySummary({
        creationTitle: "intent: seed-subject",
        intentFiles: [],
      }),
    ).toBe("intent: seed-subject");
  });

  test("returns undefined when there is no subject and no files", () => {
    expect(
      deriveIntentRunBodySummary({
        creationTitle: DEFAULT_PUBLICATION_TITLE,
        intentFiles: [],
      }),
    ).toBeUndefined();
  });
});

describe("listLandedIntentFiles", () => {
  test("prefers invocation-owned files over every markdown in the durable dir", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-intent-owned-files-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    const durableDir = join(root, "ready-intents");
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "owned.md"), "owned\n", "utf8");
    writeFileSync(join(durableDir, "other.md"), "other\n", "utf8");
    writeFileSync(join(root, ".git", "jarvis-intent-output.json"), '{"inv-1":["owned.md"]}\n', "utf8");

    await expect(listLandedIntentFiles(root, "inv-1")).resolves.toEqual(["owned.md"]);
  });

  test("fails closed instead of listing the durable dir when ownership is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-intent-owned-files-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    const durableDir = join(root, "ready-intents");
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "unrelated.md"), "unrelated\n", "utf8");

    await expect(listLandedIntentFiles(root, "inv-1")).resolves.toEqual([]);
  });
});
