import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  exitCodeForOperatorDocV2Violations,
  findOperatorDocV2Violations,
  isAllowedRetiredGenerationHistoryLine,
  isFormerV2DirectoryLayoutLine,
  isFrozenV1ContrastLine,
  isJarvisJarvis1CoexistenceLine,
  isRetiredPackageScriptTokenLine,
  runOperatorDocV2LanguageGuard,
} from "./guard-operator-doc-v2-language.ts";

const PRE_FIX_RUNBOOK_TITLE = "# v2 operator runbook\n";
const VISION_HISTORY_LINE = readFileSync(join(process.cwd(), "docs/vision.md"), "utf8").split("\n")[2] ?? "";
const BEHAVIORS_HISTORY_LINE =
  readFileSync(join(process.cwd(), "docs/v1-behaviors.md"), "utf8")
    .split("\n")
    .find((line) => line.includes("`v2/` subtrees")) ?? "";

describe("operator-doc v2 language guard", () => {
  test("rejects pre-fix operator runbook title fixture", () => {
    expect(findOperatorDocV2Violations([{ file: "docs/operator-runbook.md", source: PRE_FIX_RUNBOOK_TITLE }])).toEqual([
      { file: "docs/operator-runbook.md", line: 1, text: "# v2 operator runbook" },
    ]);
  });

  test("allows post-sweep retired-generation history lines from the operator corpus", () => {
    expect(isAllowedRetiredGenerationHistoryLine(VISION_HISTORY_LINE)).toBe(true);
    expect(isAllowedRetiredGenerationHistoryLine(BEHAVIORS_HISTORY_LINE)).toBe(true);
    expect(findOperatorDocV2Violations([{ file: "docs/vision.md", source: `${VISION_HISTORY_LINE}\n` }])).toEqual([]);
  });

  test("predicate guards reject inverted allowance", () => {
    expect(isFormerV2DirectoryLayoutLine("the `v2/` subtrees")).toBe(true);
    expect(isFormerV2DirectoryLayoutLine("# v2 operator runbook")).toBe(false);
    expect(isRetiredPackageScriptTokenLine("scripts/run-v2-tests.ts")).toBe(true);
    expect(isRetiredPackageScriptTokenLine("# v2 operator runbook")).toBe(false);
    expect(isJarvisJarvis1CoexistenceLine("v1 (`jarvis1`)")).toBe(true);
    expect(isJarvisJarvis1CoexistenceLine("# v2 operator runbook")).toBe(false);
    expect(isFrozenV1ContrastLine("Frozen `v1/` and this file's name")).toBe(true);
    expect(isFrozenV1ContrastLine("# v2 operator runbook")).toBe(false);
  });

  test("repository operator corpus passes after editorial sweep", async () => {
    expect(await runOperatorDocV2LanguageGuard(process.cwd())).toEqual([]);
  });

  test("exit code is 1 when violations exist, 0 otherwise", () => {
    expect(exitCodeForOperatorDocV2Violations([])).toBe(0);
    expect(
      exitCodeForOperatorDocV2Violations([
        { file: "docs/operator-runbook.md", line: 1, text: "# v2 operator runbook" },
      ]),
    ).toBe(1);
  });
});
