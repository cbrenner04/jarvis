import { describe, expect, test } from "bun:test";
import { findUntrackedTempDirs, TRACKED_TEMP_DIR_MODULE } from "./guard-test-temp-dir-cleanup.ts";

function violations(source: string, file = "src/execution/example.test.ts") {
  return findUntrackedTempDirs([{ file, source }]);
}

describe("test-temp-dir-cleanup guard", () => {
  test("rejects direct mkdtempSync and mkdtemp calls in test code", () => {
    const source = ['const a = mkdtempSync(join(tmpdir(), "a-"));', 'const b = await mkdtemp("b-");'].join("\n");
    expect(violations(source)).toEqual([
      { file: "src/execution/example.test.ts", line: 1 },
      { file: "src/execution/example.test.ts", line: 2 },
    ]);
  });

  test("covers test-support, the v2 harness, and the preload", () => {
    const source = 'mkdtempSync("x-");';
    for (const file of ["src/shared/a.test-support.ts", "src/testing/helpers.ts", "test/setup-fake-agents.ts"]) {
      expect(violations(source, file)).toHaveLength(1);
    }
  });

  test("accepts tracked helpers, comments, the helper module, and production code", () => {
    expect(violations('const a = trackedMkdtempSync("a-"); // mkdtempSync("x")')).toEqual([]);
    expect(violations('mkdtempSync("x-");', TRACKED_TEMP_DIR_MODULE)).toEqual([]);
    expect(violations('mkdtempSync("x-");', "src/execution/ready-finalize.ts")).toEqual([]);
  });
});
