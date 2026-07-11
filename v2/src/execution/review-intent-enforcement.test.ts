import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkVerdictOwnershipBefore, VERDICT_FILE } from "./review-intent-enforcement.ts";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "review-intent-enforcement-"));
}

describe("review-intent-enforcement", () => {
  test("checkVerdictOwnershipBefore: missing verdict file", () => {
    const path = join(dir(), "verdict.md");
    const result = checkVerdictOwnershipBefore(path);
    expect(result.kind).toBe("missing");
  });

  test("checkVerdictOwnershipBefore: empty verdict file is treated as owned", () => {
    const parent = dir();
    const path = join(parent, VERDICT_FILE);
    writeFileSync(path, "", "utf8");
    const result = checkVerdictOwnershipBefore(path);
    expect(result.kind).toBe("owned");
  });

  test("checkVerdictOwnershipBefore: non-empty verdict file is treated as foreign", () => {
    const parent = dir();
    const path = join(parent, VERDICT_FILE);
    writeFileSync(path, "some verdict content\n", "utf8");
    const result = checkVerdictOwnershipBefore(path);
    expect(result.kind).toBe("foreign");
  });

  test("VERDICT_FILE constant has correct name", () => {
    expect(VERDICT_FILE).toBe(".jarvis-intent-review-verdict.md");
  });
});
